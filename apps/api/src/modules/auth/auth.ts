import { Logger } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import {
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from '@vozzify/contracts';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { username } from 'better-auth/plugins';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { RedisThrottlerStorage } from '../../common/rate-limit/redis-throttler-storage.js';
import type { Env } from '../../config/env.js';
import type { Database } from '../../database/database.js';
import {
  accounts,
  sessions,
  verifications,
} from '../../database/schema/auth.js';
import { users } from '../../database/schema/users.js';
import type { EmailService } from '../../integrations/email/email.service.js';
import { AUTH_BASE_PATH, CLIENT_IP_HEADER } from './auth.constants.js';
import { emailOtpPlugin, notifyExistingUserSignUp } from './auth-emails.js';
import { googleProvider } from './google-provider.js';
import { nativeBearer } from './native-bearer.js';
import {
  hashPassword,
  isLegacyPasswordHash,
  verifyPassword,
} from './password.js';
import { signUpLocale } from './sign-up-locale.js';
import { enforceSignUpRules } from './sign-up-rules.js';

const DAY_SECONDS = 24 * 60 * 60;

// Input is lowercased (Better Auth's default normalization), as legacy did.
const isValidUsername = (value: string): boolean =>
  USERNAME_PATTERN.test(value);

const PASSWORD_SIGN_IN_PATHS = new Set(['/sign-in/email', '/sign-in/username']);
const passwordBodySchema = z.object({ password: z.string() });

export type AuthDependencies = {
  env: Env;
  db: Database;
  redis: Redis;
  emailService: EmailService;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The options that don't depend on the environment or on services. */
const staticOptions = {
  appName: 'vozzify',
  basePath: AUTH_BASE_PATH,
  user: {
    additionalFields: {
      // `input: false`: never settable through sign-up or update-user.
      role: {
        type: 'string',
        required: false,
        defaultValue: 'USER',
        input: false,
      },
      dailyPracticeTargetSeconds: {
        type: 'number',
        required: false,
        input: false,
      },
      // Set by `databaseHooks` from the sign-up request, never by the body.
      locale: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => ({
          data: { ...user, locale: signUpLocale(context) },
        }),
      },
    },
  },
  session: {
    // Legacy (NextAuth JWT) sessions lasted 30 days.
    expiresIn: 30 * DAY_SECONDS,
    updateAge: DAY_SECONDS,
  },
  emailAndPassword: {
    enabled: true,
    // No session until the email is verified with the OTP. Also makes
    // sign-up answer the same way for new and existing emails.
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    password: { hash: hashPassword, verify: verifyPassword },
  },
  emailVerification: {
    // Both go through `sendVerificationOTP` (`overrideDefaultEmailVerification`
    // in the emailOTP plugin): a code, not a link.
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
  },
  account: {
    // Legacy linked Google to an existing email account. Better Auth only
    // links when Google reports the email as verified, and strips access
    // an unverified local account had accrued before.
    accountLinking: { enabled: true, trustedProviders: ['google'] },
  },
  disabledPaths: [
    // Passwordless OTP sign-in isn't a vozzify feature.
    '/sign-in/email-otp',
    // Profile fields (name, username, image) are written through
    // vozzify's own `/v1/me` routes, which enforce their rules: an
    // immutable username and avatars that only we upload. Disabled for
    // everyone, so it can't be used to bypass them.
    '/update-user',
  ],
  telemetry: { enabled: false },
} satisfies BetterAuthOptions;

const rateLimitOptions = (
  env: Env,
  storage: RedisThrottlerStorage,
): BetterAuthOptions['rateLimit'] => ({
  // Off in tests so suites can sign in repeatedly.
  enabled: env.NODE_ENV !== 'test',
  window: env.RATE_LIMIT_TTL_SECONDS,
  max: env.RATE_LIMIT_MAX,
  // Shared by every instance and fails open when Redis is down, like the
  // global throttler (whose Redis storage it reuses). Better Auth adds
  // stricter per-endpoint rules (e.g. 3 sign-ins per 10s).
  customStorage: {
    consume: async (key, rule) => {
      const record = await storage.increment(
        key,
        rule.window * 1000,
        rule.max,
        0,
        'auth',
      );
      return record.isBlocked
        ? { allowed: false, retryAfter: record.timeToExpire }
        : { allowed: true, retryAfter: null };
    },
  },
});

const advancedOptions = (env: Env): BetterAuthOptions['advanced'] => ({
  cookiePrefix: 'vozzify',
  useSecureCookies: env.NODE_ENV === 'production',
  // Web on the apex and API on a subdomain: scoping the cookie to the shared
  // domain lets the web server read and forward it.
  crossSubDomainCookies:
    env.AUTH_COOKIE_DOMAIN === undefined
      ? undefined
      : { enabled: true, domain: env.AUTH_COOKIE_DOMAIN },
  ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  // Same ID format as every other table; imported legacy cuids fit too.
  database: { generateId: () => createId() },
});

const loggerOptions = (
  env: Env,
  logger: Logger,
): BetterAuthOptions['logger'] => ({
  level: env.NODE_ENV === 'production' ? 'warn' : 'info',
  // Messages only: arguments may carry user data.
  log: (level, message) => {
    if (level === 'error') logger.error(message);
    else if (level === 'warn') logger.warn(message);
    else if (level === 'info') logger.log(message);
    else logger.debug(message);
  },
});

/**
 * Replaces a legacy bcrypt hash with scrypt once the user proved the password,
 * so legacy hashes disappear over time.
 */
const rehashLegacyPassword = (logger: Logger) =>
  createAuthMiddleware(async (ctx) => {
    const userId = ctx.context.newSession?.user.id;
    const body = passwordBodySchema.safeParse(ctx.body);
    if (
      !PASSWORD_SIGN_IN_PATHS.has(ctx.path) ||
      userId === undefined ||
      !body.success
    ) {
      return;
    }
    try {
      const credential = (
        await ctx.context.internalAdapter.findAccounts(userId)
      ).find((account) => account.providerId === 'credential');
      if (credential?.password && isLegacyPasswordHash(credential.password)) {
        await ctx.context.internalAdapter.updatePassword(
          userId,
          await hashPassword(body.data.password),
        );
      }
    } catch (error) {
      // The sign-in itself succeeded; try again next time.
      logger.warn(`Could not rehash a legacy password: ${errorMessage(error)}`);
    }
  });

/**
 * The Better Auth instance behind `/v1/auth/*` (mounted in `setup-app.ts`)
 * and the global `AuthGuard`. Responses under `/v1/auth/*` use Better Auth's
 * own format (the Better Auth clients expect it), not the API error envelope.
 */
export const createAuth = ({
  env,
  db,
  redis,
  emailService,
}: AuthDependencies) => {
  const logger = new Logger('Auth');

  return betterAuth({
    ...staticOptions,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Origins allowed to call auth endpoints with cookies and to be used as
    // redirect targets (`callbackURL`).
    trustedOrigins: env.WEB_ORIGINS,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      ...staticOptions.emailAndPassword,
      onExistingUserSignUp: notifyExistingUserSignUp(emailService, logger),
    },
    socialProviders: googleProvider(env),
    rateLimit: rateLimitOptions(env, new RedisThrottlerStorage(redis)),
    advanced: advancedOptions(env),
    logger: loggerOptions(env, logger),
    plugins: [
      nativeBearer(),
      username({
        minUsernameLength: USERNAME_MIN_LENGTH,
        maxUsernameLength: USERNAME_MAX_LENGTH,
        usernameValidator: isValidUsername,
        displayUsername: false,
      }),
      emailOtpPlugin(emailService, logger),
    ],
    hooks: {
      before: enforceSignUpRules,
      after: rehashLegacyPassword(logger),
    },
  });
};

export type Auth = ReturnType<typeof createAuth>;

export type AuthSession = NonNullable<
  Awaited<ReturnType<Auth['api']['getSession']>>
>;

export type AuthUser = AuthSession['user'];
