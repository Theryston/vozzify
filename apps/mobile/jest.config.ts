import { createRequire } from 'node:module';
import type { Config } from 'jest';

const appRequire = createRequire(import.meta.url);
const expoPackagePath = appRequire.resolve('expo/package.json');
const expoRequire = createRequire(expoPackagePath);
const expoModulesCorePath = expoRequire.resolve('expo-modules-core');
const asyncStorageMockPath = appRequire.resolve(
  '@react-native-async-storage/async-storage/jest',
);

const config: Config = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^expo-modules-core$': expoModulesCorePath,
    '^@react-native-async-storage/async-storage$': asyncStorageMockPath,
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|\\.store|react-native|@react-native|@react-native-community|@rn-primitives|expo|@expo|@expo-google-fonts|react-navigation|use-intl|intl-messageformat|@formatjs|@react-navigation|@sentry/react-native|native-base|standard-navigation|uniwind))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/e2e/'],
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'src/**/*.{ts,tsx}',
    '!**/*.test.{ts,tsx}',
  ],
  coverageReporters: ['text-summary', 'html'],
  coverageThreshold: {
    global: { branches: 85, functions: 90, lines: 90, statements: 90 },
  },
};

export default config;
