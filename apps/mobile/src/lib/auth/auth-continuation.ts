import { z } from 'zod';

export const authContinuationSchema = z.discriminatedUnion('destination', [
  z.object({ destination: z.literal('/') }),
  z.object({
    destination: z.literal('/components'),
    action: z.literal('open-overlay').optional(),
  }),
]);

export type AuthContinuation = z.infer<typeof authContinuationSchema>;

export function authContinuationFromParams(params: {
  redirectTo?: string | string[];
  action?: string | string[];
}): AuthContinuation {
  if (params.redirectTo === '/components') {
    return {
      destination: '/components',
      ...(params.action === 'open-overlay' ? { action: params.action } : {}),
    };
  }
  return { destination: '/' };
}

export function authRouteParams(continuation: AuthContinuation) {
  return {
    redirectTo: continuation.destination,
    ...(continuation.destination === '/components' && continuation.action
      ? { action: continuation.action }
      : {}),
  };
}
