import type { ExpoConfig } from 'expo/config';
import { z } from 'zod';
import { createAppConfig } from '../app.config';

const baseConfig: Partial<ExpoConfig> = {
  name: 'Vozzify',
  slug: 'vozzify',
  ios: { bundleIdentifier: 'com.vozzify.app' },
  android: { package: 'com.vozzify.app' },
};

const expectedVariants = [
  {
    variant: 'development',
    name: 'Vozzify Dev',
    identifier: 'com.vozzify.app.dev',
    apiUrl: 'https://api-development.example.com',
    schemes: ['vozzify-dev', 'exp+vozzify-dev'],
  },
  {
    variant: 'preview',
    name: 'Vozzify Preview',
    identifier: 'com.vozzify.app.preview',
    apiUrl: 'https://api-preview.example.com',
    schemes: ['vozzify-preview'],
  },
  {
    variant: 'production',
    name: 'Vozzify',
    identifier: 'com.vozzify.app',
    apiUrl: 'https://api.vozzify.com',
    schemes: ['vozzify', 'exp+vozzify'],
  },
] as const;

describe('mobile app variants', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('expo-constants');
    jest.resetModules();
  });
  it.each(expectedVariants)(
    '$variant selects its native identity and API destination at runtime',
    async ({ variant, name, identifier, apiUrl, schemes }) => {
      const config = createAppConfig(baseConfig, {
        APP_VARIANT: variant,
        EXPO_PUBLIC_API_URL: `${apiUrl}/`,
      });

      expect(config.name).toBe(name);
      expect(config.ios?.bundleIdentifier).toBe(identifier);
      expect(config.android?.package).toBe(identifier);
      expect(config.owner).toBe('vozzify');
      expect(config.slug).toBe('vozzify');
      expect(config.scheme).toEqual(schemes);

      jest.resetModules();
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { expoConfig: config },
      }));
      const isolatedModules: {
        mobileApi?: typeof import('../src/lib/api/mobile-api').mobileApi;
      } = {};
      jest.isolateModules(() => {
        isolatedModules.mobileApi = jest.requireActual<
          typeof import('../src/lib/api/mobile-api')
        >('../src/lib/api/mobile-api').mobileApi;
      });
      const mobileApi = isolatedModules.mobileApi;
      if (mobileApi === undefined) throw new Error('Mobile API was not loaded');
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ id: variant }), { status: 200 }),
        );

      await expect(
        mobileApi('/tracks', { schema: z.object({ id: z.string() }) }),
      ).resolves.toEqual({ id: variant });
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${apiUrl}/v1/tracks`);
    },
  );

  it('uses development when no variant is selected', () => {
    const config = createAppConfig(baseConfig, {
      EXPO_PUBLIC_API_URL: 'https://api.example.com',
    });

    expect(config.extra?.appVariant).toBe('development');
    expect(
      createAppConfig(baseConfig, {
        APP_VARIANT: '',
        EXPO_PUBLIC_API_URL: 'https://api.example.com',
      }).extra?.appVariant,
    ).toBe('development');
  });

  it('rejects unknown variants', () => {
    expect(() =>
      createAppConfig(baseConfig, {
        APP_VARIANT: 'staging',
        EXPO_PUBLIC_API_URL: 'https://api.example.com',
      }),
    ).toThrow('APP_VARIANT');
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
