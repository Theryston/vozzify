import { AppException } from '../../common/errors/app-exception.js';
import type { StripeBillingService } from '../../integrations/stripe/stripe-billing.service.js';
import { renewalFailure } from './renewal-failure.js';
import { isPaidMembershipActive, renewalRecovery } from './renewal-recovery.js';
import { confirmedSubscription } from './subscription-state.js';
import type { SubscriptionsRepository } from './subscriptions.repository.js';
import { isAgreedTrial } from './trial-terms.js';

export async function refreshSubscription(input: {
  userId: string;
  customer: string;
  event: { type: string; created?: number; data: { object: { id?: string } } };
  repository: SubscriptionsRepository;
  stripe: StripeBillingService;
}) {
  const { userId, customer, event, repository, stripe } = input;
  const row = await repository.current(userId);
  if (!row) return false;
  const wasPro = isPaidMembershipActive(row.contract);
  const session = row.contract.checkoutId
    ? await stripe.getCheckout(row.contract.checkoutId)
    : await stripe.findCheckout(customer, row.contract.id);
  if (!session) return false;
  if (!row.contract.checkoutId)
    await repository.update(userId, {
      checkoutId: session.id,
      checkoutUrl: session.url,
    });
  if (session.customer !== customer)
    throw new AppException('CONFLICT', 'Checkout customer mismatch');
  if (session.subscription && session.status === 'complete') {
    await refreshConfirmed({
      row,
      userId,
      customer,
      event,
      repository,
      stripe,
      subscription: session.subscription,
    });
  } else if (session.status === 'expired') {
    await repository.update(userId, {
      status: 'unsuccessful',
      paidMembership: false,
    });
  }
  const current = (await repository.current(userId))?.contract;
  return (current !== undefined && isPaidMembershipActive(current)) !== wasPro;
}

async function refreshConfirmed(input: {
  row: NonNullable<Awaited<ReturnType<SubscriptionsRepository['current']>>>;
  userId: string;
  customer: string;
  event: { type: string; created?: number; data: { object: { id?: string } } };
  repository: SubscriptionsRepository;
  stripe: StripeBillingService;
  subscription: string;
}) {
  const { row, userId, customer, event, repository, stripe, subscription } =
    input;
  const provider = await stripe.getSubscription(subscription);
  const pending = await repository.change(userId);
  const activated = activatedChange(pending, provider);
  const contract = activated ? { ...row.contract, ...activated } : row.contract;
  const projection = confirmedSubscription({
    contract,
    provider,
    customer,
  });
  const paidInvoice =
    provider.status === 'active' &&
    provider.latest_invoice?.status === 'paid' &&
    provider.latest_invoice.amount_paid >= contract.amount;
  const recovery = renewalRecovery({
    hasPaidInvoice: row.contract.hasPaidInvoice,
    recoveryInvoiceId: row.contract.recoveryInvoiceId,
    recoveryStartedAt: row.contract.recoveryStartedAt,
    providerStatus: provider.status,
    paidConfirmed: paidInvoice,
    invoice: provider.latest_invoice,
    failure: await renewalFailure({
      stripe: stripe,
      customer,
      provider,
      event,
      hasPaidInvoice: row.contract.hasPaidInvoice,
      recoveryStartedAt: row.contract.recoveryStartedAt,
    }),
  });
  if (
    isAgreedTrial(row.contract.trialDays, provider) &&
    (provider.status === 'trialing'
      ? projection.paidMembership
      : ['active', 'past_due', 'unpaid', 'canceled'].includes(provider.status))
  )
    await repository.markTrialUsed(userId);
  await repository.update(userId, {
    ...projection,
    ...activatedFields(activated),
    ...recovery,
    hasPaidInvoice: row.contract.hasPaidInvoice || paidInvoice,
    ...(recovery.recoveryStartedAt
      ? { status: 'confirmed' as const, paidMembership: true }
      : {}),
  });
  if (
    pending &&
    (activated ||
      provider.cancel_at_period_end ||
      provider.status === 'canceled')
  )
    await repository.deleteChange(userId);
}

function activatedChange(
  pending: Awaited<ReturnType<SubscriptionsRepository['change']>>,
  provider: Awaited<ReturnType<StripeBillingService['getSubscription']>>,
) {
  const item = provider.items.data[0];
  const candidates = [pending?.change, pending?.change.agreed].filter(
    (value) => value != null,
  );
  const activated =
    item &&
    candidates.find(
      (change) =>
        item.price.id === change.stripePriceId &&
        item.current_period_start * 1000 >=
          new Date(change.effectiveAt).getTime(),
    );
  return activated;
}

function activatedFields(activated: ReturnType<typeof activatedChange>) {
  if (!activated) return {};
  return {
    planId: activated.planId,
    priceId: activated.priceId,
    cycle: activated.cycle,
    currency: activated.currency,
    amount: activated.amount,
    stripePriceId: activated.stripePriceId,
  };
}
