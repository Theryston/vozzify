import { z } from 'zod';
export const portalConfiguration = z.object({
  active: z.literal(true),
  livemode: z.boolean(),
  features: z.object({
    invoice_history: z.object({ enabled: z.literal(true) }),
    payment_method_update: z.object({ enabled: z.literal(true) }),
    subscription_cancel: z.object({
      enabled: z.literal(true),
      mode: z.literal('at_period_end'),
    }),
    subscription_update: z.object({ enabled: z.literal(false) }),
  }),
});
