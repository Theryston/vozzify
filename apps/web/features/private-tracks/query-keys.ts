export const privateTrackKeys = {
  list: (userId: string) => ['private-tracks', userId] as const,
};
