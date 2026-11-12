import type { ConfigContext, ExpoConfig } from 'expo/config';

import appVariants from './src/lib/config/app-variants.json';

type MobileBuildEnvironment = Readonly<Record<string, string | undefined>>;

export function createAppConfig(
  config: Partial<ExpoConfig>,
  environment: MobileBuildEnvironment,
): ExpoConfig {
  const requestedVariant = environment.APP_VARIANT ?? 'development';
  if (!Object.hasOwn(appVariants, requestedVariant)) {
    throw new Error(
      `APP_VARIANT must be development, preview, or production; received ${requestedVariant}`,
    );
  }
  const variant = requestedVariant as keyof typeof appVariants;
  const identity = appVariants[variant];
  return {
    ...config,
    name: identity.name,
    slug: config.slug ?? 'vozzify',
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
