import type { ConfigContext, ExpoConfig } from 'expo/config';

import appVariants from './src/lib/config/app-variants.json';

type AppVariant = keyof typeof appVariants;

const parseAppVariant = require('./src/lib/config/app-variant.cjs') as (
  value: string | undefined,
) => AppVariant;

type MobileBuildEnvironment = Readonly<Record<string, string | undefined>>;

export function createAppConfig(
  config: Partial<ExpoConfig>,
  environment: MobileBuildEnvironment,
): ExpoConfig {
  const variant = parseAppVariant(environment.APP_VARIANT);
  const identity = appVariants[variant];
  return {
    ...config,
    name: identity.name,
    slug: config.slug ?? 'vozzify',
    scheme: identity.schemes,
    plugins: [
      ...(config.plugins ?? []),
      ['expo-dev-client', { addGeneratedScheme: false }],
    ],
    owner: config.owner ?? 'vozzify',
    ios: {
      ...config.ios,
      bundleIdentifier: identity.iosBundleIdentifier,
    },
    android: { ...config.android, package: identity.androidPackage },
    updates: { ...config.updates, enabled: false },
    extra: {
      ...config.extra,
      apiBaseUrl: getApiBaseUrl(environment.EXPO_PUBLIC_API_URL),
      appVariant: variant,
    },
  };
}

function getApiBaseUrl(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error('EXPO_PUBLIC_API_URL is required to build the mobile app');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid HTTP(S) URL');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid HTTP(S) URL');
  }
  return url.toString().replace(/\/$/, '');
}

export default ({ config }: ConfigContext): ExpoConfig =>
  createAppConfig(config, process.env);
