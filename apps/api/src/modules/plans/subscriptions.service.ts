import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { createId } from '@paralleldrive/cuid2';
import type {
  CheckoutResult,
  CreateCheckoutBody,
  CreateSubscriptionChangeBody,
  CurrentSubscription,
  Locale,
} from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { StripeBillingService } from '../../integrations/stripe/stripe-billing.service.js';
import { checkoutOffer } from './checkout-offer.js';
import {
  isPaidMembershipActive,
  recoveryDeadline,
} from './renewal-recovery.js';
import { replaceEndedContract } from './replace-ended-contract.js';
import { SubscriptionChangesService } from './subscription-changes.service.js';
import {
  type BillingEvent,
  SubscriptionWebhookService,
} from './subscription-webhook.service.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly stripe: StripeBillingService,
    private readonly changes: SubscriptionChangesService,
    private readonly webhooks: SubscriptionWebhookService,
  ) {}

  webhook(event: BillingEvent): Promise<void> {
    return this.webhooks.handle(event);
  }

  async checkout(
    userId: string,
    body: CreateCheckoutBody,
  ): Promise<CheckoutResult> {
    await this.reserve(userId, body);
    await this.ensureCustomer(userId);
    await this.replaceEnded(userId, body);
    await this.reconcile(userId, body);
    await this.replacePendingCheckout(userId, body);
    return this.start(userId, body);
  }

  // Commit the attempt identity before calling Stripe: failures reuse the same key.
  @Transactional()
  async reserve(userId: string, body: CreateCheckoutBody) {
    await this.repository.lock(userId);
    const existing = await this.repository.current(userId);
    if (existing) return;
    await this.repository.create(await this.reservation(userId, body));
  }

  private async reservation(userId: string, body: CreateCheckoutBody) {
    const price = checkoutOffer(await this.repository.offer(body), body);
    return {
      id: createId(),
      userId,
      ...(await this.offerFields(userId, body, price)),
      checkoutId: null,
      checkoutUrl: null,
      createdAt: new Date(),
      status: 'pending' as const,
    };
  }

  private async offerFields(
    userId: string,
    body: CreateCheckoutBody,
    price: ReturnType<typeof checkoutOffer>,
  ) {
    return {
      planId: body.planId,
      priceId: price.id,
      cycle: price.cycle,
      currency: price.currency,
      amount: price.amount,
      stripePriceId: price.stripePriceId,
      trialDays: (await this.repository.customer(userId))?.trialUsedAt
        ? 0
        : price.trialDays,
    };
  }

  @Transactional()
  async ensureCustomer(userId: string) {
    await this.repository.lock(userId);
    if ((await this.repository.customer(userId))?.stripeCustomerId) return;
    await this.repository.saveCustomer(
      userId,
      await this.stripe.createCustomer(userId),
    );
  }

  @Transactional()
  async replaceEnded(userId: string, body: CreateCheckoutBody) {
    await replaceEndedContract({
      userId,
      repository: this.repository,
      stripe: this.stripe,
      reservation: () => this.reservation(userId, body),
    });
  }

  // A lost Stripe response is reconciled before changing or retrying an attempt.
  // Persist the recovered session or replacement key before any session creation.
  @Transactional()
  async reconcile(userId: string, body: CreateCheckoutBody) {
    await this.repository.lock(userId);
    const row = await this.repository.current(userId);
    if (!row || row.contract.checkoutId || row.contract.stripeSubscriptionId)
      return;
    const customer = await this.repository.customer(userId);
    if (!customer?.stripeCustomerId)
      throw new AppException('CONFLICT', 'Billing customer is missing');
    const session = await this.stripe.findCheckout(
      customer.stripeCustomerId,
      row.contract.id,
    );
    if (session) {
      await this.repository.update(userId, {
        checkoutId: session.id,
        checkoutUrl: session.url,
      });
      return;
    }
    const price = checkoutOffer(await this.repository.offer(body), body);
    if (
      row.contract.priceId === price.id &&
      Date.now() - row.contract.createdAt.getTime() < 23 * 60 * 60 * 1000
    )
      return;
    await this.repository.update(userId, {
      id: createId(),
      ...(await this.offerFields(userId, body, price)),
      createdAt: new Date(),
    });
  }

  // Expiry must succeed before committing a new attempt identity. Session creation
  // runs afterwards so a lost response can still be recovered with that identity.
  @Transactional()
  async replacePendingCheckout(userId: string, body: CreateCheckoutBody) {
    await this.repository.lock(userId);
    const row = await this.repository.current(userId);
    if (!row) return;
    const contract = row.contract;
    if (!contract.checkoutId || contract.stripeSubscriptionId) return;
    const session = await this.stripe.getCheckout(contract.checkoutId);
    if (session.status === 'complete' || session.subscription) return;
    const sameOffer =
      contract.priceId === body.offerId &&
      contract.planId === body.planId &&
      contract.cycle === body.cycle &&
      contract.trialDays === (body.trialDays ?? 0);
    if (session.status === 'open' && sameOffer) return;
    const reservation = await this.reservation(userId, body);
    assertTrialTerms(reservation.trialDays, body.trialDays);
    const expired =
      session.status === 'expired'
        ? session
        : await this.stripe.expireCheckout(session.id);
    if (
      expired.id !== session.id ||
      expired.customer !== session.customer ||
      expired.status !== 'expired' ||
      expired.subscription
    )
      throw new AppException('CONFLICT', 'Checkout could not be expired');
    await this.repository.update(userId, reservation);
  }

  @Transactional()
  async start(
    userId: string,
    body: CreateCheckoutBody,
  ): Promise<CheckoutResult> {
    await this.repository.lock(userId);
    const row = await this.repository.current(userId);
    if (!row)
      throw new AppException('CONFLICT', 'Checkout reservation is missing');
    const contract = row.contract;
    if (contract.stripeSubscriptionId) return { action: 'manage' };
    if (
      contract.priceId !== body.offerId ||
      contract.planId !== body.planId ||
      contract.cycle !== body.cycle
    )
      return { action: 'manage' };
    assertTrialTerms(contract.trialDays, body.trialDays);
    if (contract.checkoutId) {
      const session = await this.stripe.getCheckout(contract.checkoutId);
      if (session.status === 'complete' || session.subscription)
        return { action: 'manage' };
      if (session.status === 'open' && session.url)
        return { action: 'checkout', url: session.url };
      throw new AppException(
        'CONFLICT',
        'Checkout expired; retry the selected offer',
      );
    }
    checkoutOffer(await this.repository.offer(body), body);
    const customer = (await this.repository.customer(userId))?.stripeCustomerId;
    if (!customer)
      throw new AppException('CONFLICT', 'Billing customer is missing');
    const session = await this.stripe.createCheckout({
      id: contract.id,
      customer,
      price: contract.stripePriceId,
      locale: body.locale,
      trialDays: contract.trialDays,
    });
    if (!session.url || session.customer !== customer)
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'Stripe checkout is unavailable',
      );
    await this.repository.update(userId, {
      checkoutId: session.id,
      checkoutUrl: session.url,
    });
    return { action: 'checkout', url: session.url };
  }

  async change(
    userId: string,
    body: CreateSubscriptionChangeBody,
    locale: Locale,
  ) {
    await this.changes.change(userId, body);
    return this.summary(userId, locale);
  }

  async trialEligibility(userId: string) {
    const customer = await this.repository.customer(userId);
    return { eligible: !customer?.trialUsedAt };
  }

  async portal(userId: string, locale: Locale) {
    const row = await this.repository.current(userId);
    const customer = await this.repository.customer(userId);
    if (!row?.contract.stripeSubscriptionId || !customer?.stripeCustomerId)
      throw new AppException('CONFLICT', 'Subscription is unavailable');
    return {
      url: await this.stripe.createPortal(customer.stripeCustomerId, locale),
    };
  }

  async summary(userId: string, locale: Locale): Promise<CurrentSubscription> {
    const row = await this.repository.current(userId);
    if (!row) return { subscription: null };
    const contract = row.contract;
    const pendingChange = await this.changes.visible(userId, locale);
    const pendingPrice = await this.repository.pendingPrice(userId);
    const deadline = recoveryDeadline(contract.recoveryStartedAt);
    return {
      subscription: {
        pendingChange,
        ...(!contract.cancelAtPeriodEnd &&
        pendingPrice?.effectiveAt &&
        (pendingPrice.status === 'pending' ||
          pendingPrice.status === 'scheduled' ||
          pendingPrice.status === 'failed')
          ? {
              pendingPriceChange: {
                ...pendingPrice,
                effectiveAt: pendingPrice.effectiveAt.toISOString(),
                status: pendingPrice.status,
              },
            }
          : {}),
        recoveryDeadline: deadline?.toISOString() ?? null,
        planId: contract.planId,
        planName: row.copy[locale].name,
        cycle: contract.cycle,
        currency: contract.currency,
        amount: contract.amount,
        status: contract.status,
        providerStatus: contract.providerStatus,
        paidMembership: isPaidMembershipActive(contract),
        currentPeriodStart: contract.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: contract.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: contract.cancelAtPeriodEnd,
      },
    };
  }
}

function assertTrialTerms(expected: number, accepted?: number) {
  if (expected !== (accepted ?? 0))
    throw new AppException(
      'CONFLICT',
      'Trial terms have changed; review the offer',
    );
}
