import type { BetterAuthOptions } from 'better-auth';
import { verifyGoogleIdToken } from 'better-auth/social-providers';
import type { Env } from '../../config/env.js';

export function googleProvider(env: Env): BetterAuthOptions['socialProviders'] {
  const {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_NATIVE_CLIENT_IDS: audience,
  } = env;
  if (!clientId || !clientSecret) return {};

  return {
    google: {
      clientId,
      clientSecret,
      // Direct ID-token exchanges use the allowlist. The web's OAuth
      // authorization-code exchange continues to use the credentials above.
      async verifyIdToken(token, nonce) {
        if (!audience) return false;
        const claims = await verifyGoogleIdToken({ token, nonce, audience });
        // Google is a trusted account-linking provider. Require verified
        // ownership of the email before any direct token may link a User.
        return (
          claims?.email_verified === true && Boolean(claims.exp && claims.sub)
        );
      },
    },
  };
}
