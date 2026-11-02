import { z } from 'zod';
import type { StripeSubscription } from './stripe-billing-schemas.js';

export async function trialPayment(
  subscription: StripeSubscription,
  request: (path: string) => Promise<unknown>,
) {
  if (!subscription.trial_end || subscription.default_payment_method)
    return subscription;
  const customer = z
    .object({
      id: z.literal(subscription.customer),
      livemode: z.boolean(),
      invoice_settings: z.object({
        default_payment_method: z.string().nullable(),
      }),
    })
    .parse(
      await request(`customers/${encodeURIComponent(subscription.customer)}`),
    );
  const methodId = customer.invoice_settings.default_payment_method;
  if (!methodId) return subscription;
  const method = z
    .object({
      id: z.literal(methodId),
      livemode: z.boolean(),
      customer: z.literal(subscription.customer),
      type: z.literal('card'),
    })
    .parse(await request(`payment_methods/${encodeURIComponent(methodId)}`));
  return { ...subscription, default_payment_method: method.id };
}
