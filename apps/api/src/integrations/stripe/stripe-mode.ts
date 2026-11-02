import { z } from 'zod';

export const stripeModeSchema = (secret: string | undefined) =>
  z.literal(secret?.startsWith('sk_live_') ?? false);

/** Validate the provider account mode before consuming objects or list pages. */
export function parseStripeResponse(value: unknown, secret: string) {
  const object = z.object({ livemode: stripeModeSchema(secret) }).passthrough();
  if (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    Array.isArray(value.data)
  ) {
    if ('livemode' in value) object.parse(value);
    return z
      .object({ data: z.array(object) })
      .passthrough()
      .parse(value);
  }
  return object.parse(value);
}
