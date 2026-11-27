import { createAppConfig } from '../app.config';

const webClientId = 'test-web.apps.googleusercontent.com';
const iosClientId = 'test-ios.apps.googleusercontent.com';
const base = { EXPO_PUBLIC_API_URL: 'https://api.example.com' };

describe('native Google build configuration', () => {
  it.each(['development', 'preview', 'production'])(
    'uses the selected %s build environment and registers the reversed iOS ID',
    (variant) => {
      const config = createAppConfig(
        {},
        {
          ...base,
          APP_VARIANT: variant,
          EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: webClientId,
          EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: iosClientId,
        },
      );
      expect(config.extra).toMatchObject({
        appVariant: variant,
        google: { webClientId, iosClientId },
      });
      expect(config.plugins).toContainEqual([
        '@react-native-google-signin/google-signin',
        { iosUrlScheme: 'com.googleusercontent.apps.test-ios' },
      ]);
    },
  );

  it('accepts an Android-only OAuth setup', () => {
    const config = createAppConfig(
      {},
      {
        ...base,
        EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: webClientId,
      },
    );
    expect(config.extra?.google).toEqual({ webClientId });
    expect(config.plugins).not.toContainEqual([
      '@react-native-google-signin/google-signin',
      expect.anything(),
    ]);
  });

  it('rejects a partial iOS configuration', () => {
    expect(() =>
      createAppConfig(
        {},
        {
          ...base,
          EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: iosClientId,
        },
      ),
    ).toThrow('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
  });

  it('rejects a malformed ID without exposing it in the error', () => {
    expect(() =>
      createAppConfig(
        {},
        {
          ...base,
          EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'malformed',
        },
      ),
    ).toThrow(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID must be a Google OAuth client ID',
    );
  });
});
