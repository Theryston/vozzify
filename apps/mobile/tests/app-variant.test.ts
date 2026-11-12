import type { ExpoConfig } from 'expo/config';

import { createAppConfig } from '../app.config';
import { appVariants, parseAppVariant } from '../src/lib/config/app-variant';

const baseConfig: ExpoConfig = {
  name: 'Vozzify',
  slug: 'vozzify',
  ios: { bundleIdentifier: 'com.vozzify.app' },
  android: { package: 'com.vozzify.app' },
};

describe('mobile app variants', () => {
  it.each(Object.entries(appVariants))(
    'sets %s identity and keeps its API destination together',
    (variant, identity) => {
      const config = createAppConfig(baseConfig, {
        APP_VARIANT: variant,
        EXPO_PUBLIC_API_URL: `https://api-${variant}.example.com/`,
      });

      expect(config.name).toBe(identity.name);
      expect(config.ios?.bundleIdentifier).toBe(identity.iosBundleIdentifier);
      expect(config.android?.package).toBe(identity.androidPackage);
      expect(config.extra).toMatchObject({
        appVariant: variant,
        apiBaseUrl: `https://api-${variant}.example.com`,
      });
    },
  );

  it('defaults to development for local startup', () => {
    expect(parseAppVariant(undefined)).toBe('development');
  });

  it('rejects unknown variants', () => {
    expect(() => parseAppVariant('staging')).toThrow('APP_VARIANT');
  });

  it('rejects invalid API configuration before a build', () => {
    expect(() =>
      createAppConfig(baseConfig, {
        APP_VARIANT: 'preview',
        EXPO_PUBLIC_API_URL: 'file:///tmp/api',
      }),
    ).toThrow('valid HTTP(S) URL');
  });
});
