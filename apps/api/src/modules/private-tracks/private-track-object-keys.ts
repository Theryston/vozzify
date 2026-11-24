export const privateTrackMediaKey = (
  userId: string,
  privateTrackId: string,
): string => `private-tracks/${userId}/${privateTrackId}/media/music.wav`;

export const privateTrackStagingKey = (
  userId: string,
  privateTrackId: string,
  attemptId: string,
  filename: string,
): string =>
  `private-tracks/${userId}/${privateTrackId}/staging/${attemptId}/${filename}`;
