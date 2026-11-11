import type { ConfigContext, ExpoConfig } from 'expo/config';

function getApiBaseUrl(): string {
  const value = process.env.EXPO_PUBLIC_API_URL;
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

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'Vozzify',
  slug: config.slug ?? 'vozzify',
  updates: { ...config.updates, enabled: false },
  extra: { ...config.extra, apiBaseUrl: getApiBaseUrl() },
});
