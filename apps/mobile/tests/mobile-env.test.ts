import { parseMobileEnv } from '../src/lib/api/mobile-env';

describe('mobile environment', () => {
  it('accepts a configured HTTP API origin', () => {
    expect(parseMobileEnv({ apiBaseUrl: 'http://10.0.2.2:3333' })).toEqual({
      apiBaseUrl: 'http://10.0.2.2:3333',
    });
  });

  it.each([
    undefined,
    {},
    { apiBaseUrl: 'file:///tmp/api' },
    { apiBaseUrl: 'https://user:secret@example.com/api' },
    { apiBaseUrl: 'https://example.com/api?token=secret' },
  ])(
    'fails clearly when required API configuration is missing or invalid',
    (configuration) => {
      expect(() => parseMobileEnv(configuration)).toThrow(
        'Invalid mobile configuration',
      );
    },
  );
});
