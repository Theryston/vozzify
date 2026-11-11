jest.mock('expo-constants', () => {
  const actual =
    jest.requireActual<typeof import('expo-constants')>('expo-constants');
  return {
    ...actual,
    __esModule: true,
    default: {
      ...actual.default,
      expoConfig: {
        ...actual.default.expoConfig,
        extra: {
          ...actual.default.expoConfig?.extra,
          apiBaseUrl: 'http://10.0.2.2:3333',
        },
      },
    },
  };
});
