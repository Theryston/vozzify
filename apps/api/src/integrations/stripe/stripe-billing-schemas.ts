import { z } from 'zod';

export const sessionSchema = z.object({
  id: z.string(),
  livemode: z.boolean(),
  url: z.url().nullable(),
  status: z.enum(['open', 'complete', 'expired']),
  customer: z.string(),
  subscription: z.string().nullable(),
});
export type StripeCheckout = z.infer<typeof sessionSchema>;
export const subscriptionSchema = z.object({
  id: z.string(),
  livemode: z.boolean(),
  customer: z.string(),
  status: z.enum([
    'incomplete',
    'incomplete_expired',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'paused',
  ]),
  currency: z.string(),
  cancel_at_period_end: z.boolean(),
  billing_cycle_anchor: z.number().optional(),
  schedule: z.string().nullable().optional(),
  trial_end: z.number().nullable().optional(),
  trial_start: z.number().nullable().optional(),
  default_payment_method: z.string().nullable().optional(),
  latest_invoice: z
    .object({
      status: z.string().nullable(),
      id: z.string().optional(),
      billing_reason: z.string().nullable().optional(),
      created: z.number().optional(),
      due_date: z.number().nullable().optional(),
      amount_paid: z.number(),
    })
    .nullable(),
  items: z.object({
    data: z
      .array(
        z.object({
          price: z.object({
            id: z.string(),
            unit_amount: z.number().nullable(),
            currency: z.string(),
          }),
          current_period_start: z.number(),
          current_period_end: z.number(),
        }),
      )
      .length(1),
  }),
});
export type StripeSubscription = z.infer<typeof subscriptionSchema>;
