import type { ExpoConfig } from 'expo/config';

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

const apiBaseUrl = getApiBaseUrl();

const config: ExpoConfig = {
  name: 'Vozzify',
  slug: 'vozzify',
  scheme: 'vozzify',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  updates: { enabled: false },
  ios: { bundleIdentifier: 'com.vozzify.app' },
  android: { package: 'com.vozzify.app' },
  plugins: ['expo-router', 'expo-system-ui'],
  extra: { apiBaseUrl },
};

export default config;
