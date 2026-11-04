import { parseEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
};

describe('parseEnv legacy Processing concurrency', () => {
  it('leaves the optional setting unset for the runtime default', () => {
    expect(parseEnv(required).LEGACY_PROCESSING_CONCURRENCY).toBeUndefined();
  });

  it('accepts a safe operator-selected limit', () => {
    expect(
      parseEnv({ ...required, LEGACY_PROCESSING_CONCURRENCY: '4' })
        .LEGACY_PROCESSING_CONCURRENCY,
    ).toBe(4);
  });

  it.each(['0', '11', '1.5'])('rejects unsafe limit %s', (value) => {
    expect(() =>
      parseEnv({ ...required, LEGACY_PROCESSING_CONCURRENCY: value }),
    ).toThrow(/LEGACY_PROCESSING_CONCURRENCY/);
  });
});
