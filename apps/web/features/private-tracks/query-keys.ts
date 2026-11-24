export const privateTrackKeys = {
  list: (userId: string) => ['private-tracks', userId] as const,
  detail: (userId: string, trackId: string) =>
    ['private-track', userId, trackId] as const,
};
