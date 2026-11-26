export const privateTrackKeys = {
  recordingSearch: (query: string) =>
    ['private-track-recording-search', query] as const,
  list: (userId: string) => ['private-tracks', userId] as const,
  detail: (userId: string, trackId: string) =>
    ['private-track', userId, trackId] as const,
};
