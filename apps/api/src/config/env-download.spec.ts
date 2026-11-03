import { parseEnv } from './env.js';

const required = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/vozzify',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv direct audio download', () => {
  it('uses the ffmpeg executable from PATH by default', () => {
    expect(parseEnv(required).FFMPEG_PATH).toBeUndefined();
  });
  it('accepts a custom ffmpeg executable', () => {
    expect(
      parseEnv({ ...required, FFMPEG_PATH: '/opt/ffmpeg/bin/ffmpeg' })
        .FFMPEG_PATH,
    ).toBe('/opt/ffmpeg/bin/ffmpeg');
  });
  it('boots in production without a third-party download API key', () => {
    expect(
      parseEnv({
        ...required,
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        REVALIDATE_SECRET: 'x'.repeat(32),
        RESEND_API_KEY: 're_123',
        RUNPOD_API_KEY: 'runpod-key',
        RUNPOD_ENDPOINT_ID: 'endpoint-1',
      }).NODE_ENV,
    ).toBe('production');
  });
  it('counts a blank executable setting as unset', () => {
    expect(
      parseEnv({ ...required, FFMPEG_PATH: '' }).FFMPEG_PATH,
    ).toBeUndefined();
  });
});
