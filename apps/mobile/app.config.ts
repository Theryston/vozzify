import type { ConfigContext, ExpoConfig } from 'expo/config';

import appVariants from './src/lib/config/app-variants.json';

type AppVariant = keyof typeof appVariants;

type MobileBuildEnvironment = Readonly<Record<string, string | undefined>>;

const googleClientIdSuffix = '.apps.googleusercontent.com';
const googleClientIdPattern =
  /^[a-zA-Z0-9-]+[.]apps[.]googleusercontent[.]com$/;

function readGoogleClientId(environment: MobileBuildEnvironment, key: string) {
  const id = environment[key]?.trim();
  if (!id) return undefined;
  if (!googleClientIdPattern.test(id)) {
    throw new Error(`${key} must be a Google OAuth client ID`);
  }
  return id;
}

function getGoogleConfig(environment: MobileBuildEnvironment) {
  const webClientId = readGoogleClientId(
    environment,
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  );
  const iosClientId = readGoogleClientId(
    environment,
    'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
  );
  if (iosClientId && !webClientId) {
    throw new Error(
      'Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to enable Google sign-in',
    );
  }
  if (!webClientId) return undefined;
  return { webClientId, ...(iosClientId ? { iosClientId } : {}) };
}

function googleConfigPlugins(
  iosClientId: string | undefined,
): NonNullable<ExpoConfig['plugins']> {
  if (!iosClientId) return [];
  const prefix = iosClientId.slice(0, -googleClientIdSuffix.length);
  return [
    [
      '@react-native-google-signin/google-signin',
      {
        iosUrlScheme: `com.googleusercontent.apps.${prefix}`,
      },
    ],
  ];
}

function parseAppVariant(value: string | undefined): AppVariant {
  if (value === undefined || value === '') return 'development';
  if (
    value === 'development' ||
    value === 'preview' ||
    value === 'production'
  ) {
    return value;
  }
  throw new Error(
    `APP_VARIANT must be development, preview, or production; received ${value}`,
  );
}

export function createAppConfig(
  config: Partial<ExpoConfig>,
  environment: MobileBuildEnvironment,
): ExpoConfig {
  const variant = parseAppVariant(environment.APP_VARIANT);
  const identity = appVariants[variant];
  const google = getGoogleConfig(environment);
  return {
    ...config,
    name: identity.name,
    slug: config.slug ?? 'vozzify',
    scheme: identity.schemes,
    plugins: [
      ...(config.plugins ?? []),
      ['expo-dev-client', { addGeneratedScheme: false }],
      'expo-secure-store',
      ...googleConfigPlugins(google?.iosClientId),
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
      ...(google ? { google } : {}),
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
