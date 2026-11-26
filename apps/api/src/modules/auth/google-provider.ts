import type { BetterAuthOptions } from 'better-auth';
import { verifyGoogleIdToken } from 'better-auth/social-providers';
import type { Env } from '../../config/env.js';
import { isNativeAuthRequest } from './native-bearer.js';

export function googleProvider(env: Env): BetterAuthOptions['socialProviders'] {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } =
    env;
  if (!clientId || !clientSecret) return {};

  return {
    google: {
      clientId,
      clientSecret,
      // The web authorization-code flow still uses its original client ID
      // and secret. This verifier handles only client-submitted ID tokens.
      async verifyIdToken(token, nonce, context) {
        const native = isNativeAuthRequest(
          context?.request?.headers ?? context?.headers,
        );
        if (native && !env.GOOGLE_NATIVE_CLIENT_IDS) return false;
        const audience = native
          ? (env.GOOGLE_NATIVE_CLIENT_IDS ?? [])
          : clientId;
        const claims = await verifyGoogleIdToken({ token, nonce, audience });
        if (!claims) return false;
        // Google is a trusted account-linking provider. Require verified
        // ownership of the email before native tokens may link a User.
        return (
          !native ||
          (claims.email_verified === true && Boolean(claims.exp && claims.sub))
        );
      },
    },
  };
}
