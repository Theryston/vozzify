import type { PrivateTracksRepository } from './private-tracks.repository.js';

type PrivateTrackRow = NonNullable<
  Awaited<ReturnType<PrivateTracksRepository['findOwned']>>
>;

export type PrivateTrackDisplaySource = Pick<
  PrivateTrackRow,
  'title' | 'artist'
> &
  Partial<
    Pick<PrivateTrackRow, 'titleOverride' | 'artistOverride' | 'recordingLink'>
  >;

/** The current display fields, with manual corrections applied first. */
export function displayPrivateTrack(track: PrivateTrackDisplaySource) {
  const recording =
    track.recordingLink?.kind === 'linked'
      ? track.recordingLink.recording
      : undefined;
  return {
    title: track.titleOverride ?? recording?.title ?? track.title,
    artist: track.artistOverride ?? recording?.artist ?? track.artist,
    recording,
  };
}
