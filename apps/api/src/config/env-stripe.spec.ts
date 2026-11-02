import { parseEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgres://localhost/stripe',
  REDIS_URL: 'redis://localhost',
  BETTER_AUTH_SECRET: 'auth-secret-for-stripe-tests-only-1234',
  REVALIDATE_SECRET: 'revalidate-secret-for-stripe-tests-1234',
  RESEND_API_KEY: 'resend-test-only',
  RAPIDAPI_API_KEY: 'rapidapi-test-only',
  RUNPOD_API_KEY: 'runpod-test-only',
  RUNPOD_ENDPOINT_ID: 'endpoint-test-only',
};

describe('Stripe credentials', () => {
  it.each(['development', 'test', 'production'])(
    'accepts both account modes in %s',
    (NODE_ENV) => {
      for (const mode of ['test', 'live']) {
        const key = `sk_${mode}_fixture123`;
        expect(
          parseEnv({ ...required, NODE_ENV, STRIPE_SECRET_KEY: key })
            .STRIPE_SECRET_KEY,
        ).toBe(key);
      }
    },
  );

  it.each(['sk_live_', 'sk_test_', 'pk_live_public', 'sk_live_with spaces'])(
    'rejects an invalid secret key: %s',
    (STRIPE_SECRET_KEY) => {
      expect(() => parseEnv({ ...required, STRIPE_SECRET_KEY })).toThrow(
        'Invalid environment variables',
      );
    },
  );
});
