import type { BetterAuthOptions } from 'better-auth';
import { verifyGoogleIdToken } from 'better-auth/social-providers';
import type { Env } from '../../config/env.js';
import { isNativeAuthRequest } from './native-bearer.js';

export function googleProvider(env: Env): BetterAuthOptions['socialProviders'] {
  const {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_NATIVE_CLIENT_IDS: nativeClientIds,
  } = env;
  if (!clientId || !clientSecret) return {};

  return {
    google: {
      clientId,
      clientSecret,
      // Preserve the web client's audience on direct web requests and its
      // credentials on the OAuth authorization-code exchange.
      async verifyIdToken(token, nonce, context) {
        const native = isNativeAuthRequest(
          context?.request?.headers ?? context?.headers,
        );
        const audience = native ? nativeClientIds : clientId;
        if (!audience) return false;
        const claims = await verifyGoogleIdToken({ token, nonce, audience });
        return (
          typeof claims?.email_verified === 'boolean' &&
          Boolean(claims.exp && claims.sub)
        );
      },
    },
  };
}
