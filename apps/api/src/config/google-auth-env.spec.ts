import { googleAuthEnvSchema } from './google-auth-env.js';

const web = {
  GOOGLE_CLIENT_ID: 'web-client-id',
  GOOGLE_CLIENT_SECRET: 'web-client-secret',
};
const ios = 'ios.apps.googleusercontent.com';
const server = 'mobile-server.apps.googleusercontent.com';

describe('native Google client allowlist configuration', () => {
  it('trims each configured public audience', () => {
    expect(
      googleAuthEnvSchema.parse({
        ...web,
        GOOGLE_NATIVE_CLIENT_IDS: `${server}, ${ios}`,
      }),
    ).toEqual({ ...web, GOOGLE_NATIVE_CLIENT_IDS: [server, ios] });
  });

  it('treats an empty allowlist as unconfigured', () => {
    expect(
      googleAuthEnvSchema.parse({ ...web, GOOGLE_NATIVE_CLIENT_IDS: '' }),
    ).toEqual({ ...web, GOOGLE_NATIVE_CLIENT_IDS: undefined });
  });

  it('rejects the allowlist without an existing Google provider', () => {
    expect(() =>
      googleAuthEnvSchema.parse({ GOOGLE_NATIVE_CLIENT_IDS: ios }),
    ).toThrow('Configure the Google provider');
  });

  it('rejects malformed Google client IDs', () => {
    expect(() =>
      googleAuthEnvSchema.parse({
        ...web,
        GOOGLE_NATIVE_CLIENT_IDS: 'not-an-id',
      }),
    ).toThrow('GOOGLE_NATIVE_CLIENT_IDS');
  });
});
