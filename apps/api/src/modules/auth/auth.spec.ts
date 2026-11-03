import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { type Env, parseEnv } from '../../config/env.js';
import type { Database } from '../../database/database.js';
import type { EmailService } from '../../integrations/email/email.service.js';
import { createAuth } from './auth.js';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://vozzify@localhost:5432/vozzify',
  REDIS_URL: 'redis://localhost:6379',
};

const productionEnv = {
  ...baseEnv,
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  REVALIDATE_SECRET: 'b'.repeat(32),
  RESEND_API_KEY: 're_123',
  RUNPOD_API_KEY: 'runpod-key',
  RUNPOD_ENDPOINT_ID: 'endpoint-1',
};

const setup = (env: Env = parseEnv(baseEnv)) => {
  const redis = { eval: vi.fn() };
  const emailService = {
    sendOtp: vi.fn().mockResolvedValue(undefined),
    sendAccountExists: vi.fn().mockResolvedValue(undefined),
  };
  const auth = createAuth({
    env,
    // Better Auth only reaches the database on requests, never here.
    db: {} as Database,
    redis: redis as unknown as Redis,
    emailService: emailService as unknown as EmailService,
  });
  return { auth, redis, emailService };
};

const sendVerificationOtp = (auth: ReturnType<typeof setup>['auth']) => {
  const plugin = auth.options.plugins.find(({ id }) => id === 'email-otp');
  if (plugin?.id !== 'email-otp') throw new Error('emailOTP plugin missing');
  return plugin.options.sendVerificationOTP;
};

const onExistingUserSignUp = (auth: ReturnType<typeof setup>['auth']) => {
  const hook = auth.options.emailAndPassword.onExistingUserSignUp;
  if (!hook) throw new Error('onExistingUserSignUp missing');
  return hook;
};

describe('createAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enables Google sign-in only when its credentials are set', () => {
    expect(setup().auth.options.socialProviders).toEqual({});

    const { auth } = setup(
      parseEnv({
        ...baseEnv,
        GOOGLE_CLIENT_ID: 'google-id',
        GOOGLE_CLIENT_SECRET: 'google-secret',
      }),
    );
    expect(auth.options.socialProviders).toEqual({
      google: { clientId: 'google-id', clientSecret: 'google-secret' },
    });
  });

  it('shares secure cookies with the web domain in production', () => {
    const { auth } = setup(
      parseEnv({ ...productionEnv, AUTH_COOKIE_DOMAIN: 'vozzify.com' }),
    );
    expect(auth.options.advanced).toMatchObject({
      useSecureCookies: true,
      crossSubDomainCookies: { enabled: true, domain: 'vozzify.com' },
    });
  });

  it('keeps host-only, non-secure cookies outside production', () => {
    expect(setup().auth.options.advanced).toMatchObject({
      useSecureCookies: false,
      crossSubDomainCookies: undefined,
    });
  });

  it('disables update-user, so profile fields only change through /v1/me', () => {
    expect(setup().auth.options.disabledPaths).toContain('/update-user');
  });

  it('generates cuid2 IDs, like every other table', () => {
    const generateId = setup().auth.options.advanced?.database?.generateId;
    if (typeof generateId !== 'function') throw new Error('no generateId');
    expect(generateId({ model: 'user' })).toMatch(/^[a-z0-9]{24}$/);
  });

  describe('rate limiting', () => {
    it('is off in tests and on elsewhere', () => {
      expect(setup().auth.options.rateLimit?.enabled).toBe(false);
      expect(
        setup(parseEnv(productionEnv)).auth.options.rateLimit?.enabled,
      ).toBe(true);
    });

    it('blocks when the shared Redis counter says so', async () => {
      const { auth, redis } = setup();
      const consume = auth.options.rateLimit?.customStorage?.consume;
      if (!consume) throw new Error('no custom rate limit storage');

      redis.eval.mockResolvedValueOnce([4, 9_500, 1, 0]);
      await expect(consume('ip', { window: 10, max: 3 })).resolves.toEqual({
        allowed: false,
        retryAfter: 10,
      });

      redis.eval.mockResolvedValueOnce([1, 10_000, 0, 0]);
      await expect(consume('ip', { window: 10, max: 3 })).resolves.toEqual({
        allowed: true,
        retryAfter: null,
      });
    });
  });

  it('routes Better Auth logs to the Nest logger by level', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockReturnValue();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockReturnValue();
    const log = vi.spyOn(Logger.prototype, 'log').mockReturnValue();
    const debug = vi.spyOn(Logger.prototype, 'debug').mockReturnValue();
    const logger = setup().auth.options.logger;

    logger?.log?.('error', 'e');
    logger?.log?.('warn', 'w');
    logger?.log?.('info', 'i');
    logger?.log?.('debug', 'd');

    expect(error).toHaveBeenCalledWith('e');
    expect(warn).toHaveBeenCalledWith('w');
    expect(log).toHaveBeenCalledWith('i');
    expect(debug).toHaveBeenCalledWith('d');
  });

  describe('one-time code emails', () => {
    it('sends verification codes in the requester language', async () => {
      const { auth, emailService } = setup();
      await sendVerificationOtp(auth)(
        { email: 'ana@example.com', otp: '123456', type: 'email-verification' },
        // Only the request headers are read from Better Auth's context.
        {
          headers: new Headers({ 'accept-language': 'pt-BR,pt;q=0.9' }),
        } as never,
      );
      expect(emailService.sendOtp).toHaveBeenCalledWith({
        to: 'ana@example.com',
        type: 'email-verification',
        otp: '123456',
        locale: 'pt-BR',
        expiresInMinutes: expect.any(Number),
      });
    });

    it('ignores code types vozzify does not use', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockReturnValue();
      const { auth, emailService } = setup();
      await sendVerificationOtp(auth)(
        { email: 'ana@example.com', otp: '123456', type: 'sign-in' },
        undefined,
      );
      expect(emailService.sendOtp).not.toHaveBeenCalled();
    });

    it('logs instead of failing when the email cannot be enqueued', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockReturnValue();
      const { auth, emailService } = setup();
      emailService.sendOtp.mockRejectedValueOnce(new Error('Redis down'));

      await sendVerificationOtp(auth)(
        { email: 'ana@example.com', otp: '123456', type: 'forget-password' },
        undefined,
      );
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          'Could not enqueue a code email: Redis down',
        ),
      );
    });
  });

  it('accepts passwords from 6 characters, like legacy', () => {
    const { auth } = setup();
    expect(auth.options.emailAndPassword.minPasswordLength).toBe(6);
  });

  describe('sign-up with an existing email', () => {
    const existingUser = { email: 'ana@example.com' } as never;

    it('tells the owner in the requester language', async () => {
      const { auth, emailService } = setup();
      await onExistingUserSignUp(auth)(
        { user: existingUser },
        new Request('http://api.test/v1/auth/sign-up/email', {
          headers: { 'accept-language': 'pt-BR' },
        }),
      );
      expect(emailService.sendAccountExists).toHaveBeenCalledWith({
        to: 'ana@example.com',
        locale: 'pt-BR',
      });
    });

    it('falls back to English without a request', async () => {
      const { auth, emailService } = setup();
      await onExistingUserSignUp(auth)({ user: existingUser });
      expect(emailService.sendAccountExists).toHaveBeenCalledWith({
        to: 'ana@example.com',
        locale: 'en',
      });
    });

    it('logs instead of failing when the email cannot be enqueued', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockReturnValue();
      const { auth, emailService } = setup();
      emailService.sendAccountExists.mockRejectedValueOnce(
        new Error('Redis down'),
      );

      await onExistingUserSignUp(auth)({ user: existingUser });
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          'Could not enqueue an account-exists email: Redis down',
        ),
      );
    });
  });
});
