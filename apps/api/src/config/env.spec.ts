import { parseEnv } from './env.js';

const DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
const REDIS_URL = 'redis://localhost:6379';
const SECRET = 'x'.repeat(32);
const AUTH_SECRET = 'a'.repeat(32);
const required = { DATABASE_URL, REDIS_URL, BETTER_AUTH_SECRET: AUTH_SECRET };

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv(required)).toEqual({
      NODE_ENV: 'development',
      PORT: 3333,
      WEB_ORIGINS: ['http://localhost:3000'],
      SWAGGER_ENABLED: true,
      DATABASE_URL,
      REDIS_URL,
      TRUST_PROXY: 'loopback, linklocal, uniquelocal',
      RATE_LIMIT_TTL_SECONDS: 60,
      RATE_LIMIT_MAX: 120,
      WEB_URL: 'http://localhost:3000',
      REVALIDATE_SECRET: undefined,
      BETTER_AUTH_SECRET: AUTH_SECRET,
      BETTER_AUTH_URL: 'http://localhost:3333',
      AUTH_COOKIE_DOMAIN: undefined,
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      RESEND_API_KEY: undefined,
      EMAIL_FROM: 'vozzify <noreply@vozzify.com>',
    });
  });

  it('parses a production config', () => {
    expect(
      parseEnv({
        DATABASE_URL,
        NODE_ENV: 'production',
        PORT: '8080',
        WEB_ORIGINS: 'https://vozzify.com, https://www.vozzify.com',
        REDIS_URL: 'rediss://user:pass@redis.internal:6380/1',
        TRUST_PROXY: '2',
        RATE_LIMIT_TTL_SECONDS: '30',
        RATE_LIMIT_MAX: '60',
        WEB_URL: 'https://vozzify.com/',
        REVALIDATE_SECRET: SECRET,
        BETTER_AUTH_SECRET: AUTH_SECRET,
        BETTER_AUTH_URL: 'https://api.vozzify.com/',
        AUTH_COOKIE_DOMAIN: 'vozzify.com',
        GOOGLE_CLIENT_ID: 'google-id',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        RESEND_API_KEY: 're_123',
        RUNPOD_API_KEY: 'runpod-key',
        RUNPOD_ENDPOINT_ID: 'endpoint-1',
        EMAIL_FROM: 'vozzify <hi@vozzify.com>',
      }),
    ).toEqual({
      NODE_ENV: 'production',
      PORT: 8080,
      WEB_ORIGINS: ['https://vozzify.com', 'https://www.vozzify.com'],
      SWAGGER_ENABLED: false,
      DATABASE_URL,
      REDIS_URL: 'rediss://user:pass@redis.internal:6380/1',
      TRUST_PROXY: 2,
      RATE_LIMIT_TTL_SECONDS: 30,
      RATE_LIMIT_MAX: 60,
      WEB_URL: 'https://vozzify.com',
      REVALIDATE_SECRET: SECRET,
      BETTER_AUTH_SECRET: AUTH_SECRET,
      BETTER_AUTH_URL: 'https://api.vozzify.com',
      AUTH_COOKIE_DOMAIN: 'vozzify.com',
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      RESEND_API_KEY: 're_123',
      RUNPOD_API_KEY: 'runpod-key',
      RUNPOD_ENDPOINT_ID: 'endpoint-1',
      EMAIL_FROM: 'vozzify <hi@vozzify.com>',
    });
  });

  it('lets SWAGGER_ENABLED override the production default', () => {
    expect(
      parseEnv({
        ...required,
        NODE_ENV: 'production',
        SWAGGER_ENABLED: 'true',
        REVALIDATE_SECRET: SECRET,
        RESEND_API_KEY: 're_123',
        RUNPOD_API_KEY: 'runpod-key',
        RUNPOD_ENDPOINT_ID: 'endpoint-1',
      }).SWAGGER_ENABLED,
    ).toBe(true);
    expect(
      parseEnv({ ...required, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED,
    ).toBe(false);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['1', 1],
    ['10.0.0.0/8, 172.16.0.0/12', '10.0.0.0/8, 172.16.0.0/12'],
  ])('parses TRUST_PROXY=%s', (value, expected) => {
    expect(parseEnv({ ...required, TRUST_PROXY: value }).TRUST_PROXY).toBe(
      expected,
    );
  });

  it('requires a Postgres DATABASE_URL', () => {
    const { DATABASE_URL: _, ...withoutDatabase } = required;
    expect(() => parseEnv(withoutDatabase)).toThrowError(/DATABASE_URL/);
    expect(() =>
      parseEnv({ ...required, DATABASE_URL: 'mysql://localhost:3306/db' }),
    ).toThrowError(/DATABASE_URL/);
    expect(
      parseEnv({ ...required, DATABASE_URL: 'postgresql://localhost/db' })
        .DATABASE_URL,
    ).toBe('postgresql://localhost/db');
  });

  it('requires a Redis URL', () => {
    const { REDIS_URL: _, ...withoutRedis } = required;
    expect(() => parseEnv(withoutRedis)).toThrowError(/REDIS_URL/);
    expect(() =>
      parseEnv({ ...required, REDIS_URL: 'http://localhost' }),
    ).toThrowError(/REDIS_URL/);
  });

  it('requires REVALIDATE_SECRET only in production', () => {
    expect(() =>
      parseEnv({ ...required, NODE_ENV: 'production', RESEND_API_KEY: 'k' }),
    ).toThrowError(/REVALIDATE_SECRET/);
    expect(
      parseEnv({ ...required, REVALIDATE_SECRET: '' }).REVALIDATE_SECRET,
    ).toBe(undefined);
    expect(() =>
      parseEnv({ ...required, REVALIDATE_SECRET: 'too-short' }),
    ).toThrowError(/REVALIDATE_SECRET/);
  });

  it('requires BETTER_AUTH_SECRET outside tests', () => {
    const { BETTER_AUTH_SECRET: _, ...withoutSecret } = required;
    expect(() => parseEnv(withoutSecret)).toThrowError(/BETTER_AUTH_SECRET/);
    expect(() =>
      parseEnv({ ...required, BETTER_AUTH_SECRET: '' }),
    ).toThrowError(/BETTER_AUTH_SECRET/);
    expect(() =>
      parseEnv({ ...required, BETTER_AUTH_SECRET: 'too-short' }),
    ).toThrowError(/BETTER_AUTH_SECRET/);
    expect(
      parseEnv({ ...withoutSecret, NODE_ENV: 'test' }).BETTER_AUTH_SECRET
        .length,
    ).toBeGreaterThanOrEqual(32);
  });

  it('requires RESEND_API_KEY only in production', () => {
    expect(() =>
      parseEnv({
        ...required,
        NODE_ENV: 'production',
        REVALIDATE_SECRET: SECRET,
      }),
    ).toThrowError(/RESEND_API_KEY/);
    expect(parseEnv({ ...required, RESEND_API_KEY: '' }).RESEND_API_KEY).toBe(
      undefined,
    );
  });

  it('requires both Google credentials or neither', () => {
    expect(() =>
      parseEnv({ ...required, GOOGLE_CLIENT_ID: 'id' }),
    ).toThrowError(/GOOGLE_CLIENT_SECRET/);
    expect(() =>
      parseEnv({ ...required, GOOGLE_CLIENT_SECRET: 'secret' }),
    ).toThrowError(/GOOGLE_CLIENT_SECRET/);
    expect(
      parseEnv({ ...required, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }),
    ).toMatchObject({
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
    });
  });

  it('fails fast with a readable message', () => {
    expect(() =>
      parseEnv({ ...required, PORT: 'abc', WEB_ORIGINS: 'not-a-url' }),
    ).toThrowError(
      /Invalid environment variables:[\s\S]*PORT[\s\S]*WEB_ORIGINS/,
    );
  });
});

describe('parseEnv S3 storage settings', () => {
  const storage = {
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'vozzify',
    S3_ACCESS_KEY_ID: 'access-key',
    S3_SECRET_ACCESS_KEY: 'secret-key',
    S3_FORCE_PATH_STYLE: 'true',
    S3_PUBLIC_URL: 'http://localhost:9000/vozzify/',
  };
  const mandatory = [
    'S3_REGION',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_PUBLIC_URL',
  ] as const;

  it('parses a complete config', () => {
    expect(parseEnv({ ...required, ...storage })).toMatchObject({
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'vozzify',
      S3_ACCESS_KEY_ID: 'access-key',
      S3_SECRET_ACCESS_KEY: 'secret-key',
      S3_FORCE_PATH_STYLE: true,
      // Trailing slashes are dropped so URLs can be built as `${base}/${key}`.
      S3_PUBLIC_URL: 'http://localhost:9000/vozzify',
    });
  });

  it('drops every trailing slash of the public URL', () => {
    expect(
      parseEnv({
        ...required,
        ...storage,
        S3_PUBLIC_URL: 'https://files.vozzify.com//',
      }).S3_PUBLIC_URL,
    ).toBe('https://files.vozzify.com');
  });

  it('needs neither the endpoint nor path style on AWS', () => {
    const { S3_ENDPOINT: _, S3_FORCE_PATH_STYLE: __, ...aws } = storage;
    const env = parseEnv({ ...required, ...aws });
    expect(env.S3_ENDPOINT).toBeUndefined();
    expect(env.S3_FORCE_PATH_STYLE).toBeUndefined();
    expect(env.S3_BUCKET).toBe('vozzify');
  });

  it('accepts a config with no S3 variable at all', () => {
    const env = parseEnv(required);
    for (const key of [...mandatory, 'S3_ENDPOINT', 'S3_FORCE_PATH_STYLE']) {
      expect(env[key as keyof typeof env]).toBeUndefined();
    }
  });

  it('counts blank variables as unset', () => {
    const blank = Object.fromEntries(Object.keys(storage).map((k) => [k, '']));
    const env = parseEnv({ ...required, ...blank });
    expect(env.S3_BUCKET).toBeUndefined();
    expect(env.S3_FORCE_PATH_STYLE).toBeUndefined();
  });

  it.each(mandatory)('requires %s once another S3 variable is set', (key) => {
    const { [key]: _, ...incomplete } = storage;
    const expected = new RegExp(
      `Required when any S3_ variable is set[\\s\\S]*at ${key}`,
    );
    expect(() => parseEnv({ ...required, ...incomplete })).toThrowError(
      expected,
    );
    expect(() =>
      parseEnv({ ...required, ...incomplete, [key]: '' }),
    ).toThrowError(expected);
  });

  it.each(['S3_ENDPOINT', 'S3_FORCE_PATH_STYLE'] as const)(
    'does not accept %s alone',
    (key) => {
      expect(() => parseEnv({ ...required, [key]: storage[key] })).toThrowError(
        /S3_BUCKET/,
      );
    },
  );

  it.each([
    ['S3_ENDPOINT', 'localhost:9000'],
    ['S3_PUBLIC_URL', 'files.vozzify.com'],
    ['S3_BUCKET', 'ab'],
    ['S3_BUCKET', 'Uppercase'],
    ['S3_BUCKET', '-leading-hyphen'],
    ['S3_BUCKET', 'trailing-hyphen-'],
    ['S3_BUCKET', 'under_score'],
    ['S3_BUCKET', 'a'.repeat(64)],
    ['S3_FORCE_PATH_STYLE', 'maybe'],
  ])('rejects %s=%s', (key, value) => {
    expect(() =>
      parseEnv({ ...required, ...storage, [key]: value }),
    ).toThrowError(new RegExp(key));
  });

  it.each(['abc', 'vozzify-files', 'files.vozzify.com', 'a'.repeat(63)])(
    'accepts the bucket name %s',
    (bucket) => {
      expect(
        parseEnv({ ...required, ...storage, S3_BUCKET: bucket }).S3_BUCKET,
      ).toBe(bucket);
    },
  );
});
