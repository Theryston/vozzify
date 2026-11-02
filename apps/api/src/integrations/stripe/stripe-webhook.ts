import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';
import { stripeModeSchema } from './stripe-mode.js';

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  created: z.number().int().nonnegative().optional(),
  livemode: z.boolean(),
  data: z.object({
    object: z.object({
      customer: z.string().optional(),
      id: z.string().optional(),
    }),
  }),
});

/** Stripe signs the exact raw bytes, with a five-minute replay tolerance. */
export function verifyStripeEvent(input: {
  body: Buffer;
  signature: string;
  secret: string | undefined;
  apiKey: string | undefined;
}) {
  const pieces = input.signature.split(',').map((part) => part.split('='));
  const timestamp = pieces.find(([key]) => key === 't')?.[1];
  const expected = createHmac('sha256', input.secret ?? '')
    .update(`${timestamp}.`)
    .update(input.body)
    .digest();
  const valid = pieces.some(([key, value]) => {
    if (key !== 'v1' || !value || !/^[a-fA-F0-9]{64}$/.test(value))
      return false;
    return timingSafeEqual(expected, Buffer.from(value, 'hex'));
  });
  if (
    !input.secret ||
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !valid
  )
    throw new AppException('BAD_REQUEST', 'Invalid Stripe signature');
  const result = eventSchema
    .extend({ livemode: stripeModeSchema(input.apiKey) })
    .safeParse(JSON.parse(input.body.toString('utf8')));
  if (!result.success)
    throw new AppException('BAD_REQUEST', 'Invalid Stripe event');
  return result.data;
}
