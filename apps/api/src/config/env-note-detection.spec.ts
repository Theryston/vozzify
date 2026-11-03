import { parseEnv } from './env.js';

// The note detection settings (RunPod), kept apart from env.spec.ts.
const required = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/vozzify',
  REDIS_URL: 'redis://localhost:6379',
};

const production = {
  ...required,
  NODE_ENV: 'production',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  REVALIDATE_SECRET: 'x'.repeat(32),
  RESEND_API_KEY: 're_123',
};

describe('parseEnv note detection settings', () => {
  it('leaves the RunPod settings unset outside production', () => {
    const env = parseEnv(required);

    expect(env.RUNPOD_API_KEY).toBeUndefined();
    expect(env.RUNPOD_ENDPOINT_ID).toBeUndefined();
  });

  it('requires the RunPod API key in production', () => {
    expect(() =>
      parseEnv({ ...production, RUNPOD_ENDPOINT_ID: 'endpoint-1' }),
    ).toThrow('RUNPOD_API_KEY');
  });

  it('requires the RunPod endpoint ID in production', () => {
    expect(() =>
      parseEnv({ ...production, RUNPOD_API_KEY: 'runpod-key' }),
    ).toThrow('RUNPOD_ENDPOINT_ID');
  });

  it('parses both RunPod settings in production', () => {
    expect(
      parseEnv({
        ...production,
        RUNPOD_API_KEY: 'runpod-key',
        RUNPOD_ENDPOINT_ID: 'endpoint-1',
      }),
    ).toMatchObject({
      RUNPOD_API_KEY: 'runpod-key',
      RUNPOD_ENDPOINT_ID: 'endpoint-1',
    });
  });

  it('counts blank RunPod values as unset, so production refuses them', () => {
    expect(() =>
      parseEnv({
        ...production,
        RUNPOD_API_KEY: '',
        RUNPOD_ENDPOINT_ID: 'endpoint-1',
      }),
    ).toThrow('RUNPOD_API_KEY');
  });
});
