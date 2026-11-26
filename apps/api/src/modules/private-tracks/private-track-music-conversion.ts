import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRIVATE_AUDIO_MAX_DURATION_SECONDS } from '@vozzify/contracts';
import { privateTrackMediaKey } from './private-track-object-keys.js';
import { PrivateTrackProcessingIntegrations } from './private-track-processing-integrations.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';

type OwnedPrivateTrack = NonNullable<
  Awaited<ReturnType<PrivateTracksRepository['findOwned']>>
>;

export async function ensurePrivateTrackMusicWav(
  track: OwnedPrivateTrack,
  tracks: PrivateTracksRepository,
  integrations: PrivateTrackProcessingIntegrations,
): Promise<string | null> {
  if (track.mediaObjectKey !== null) return track.mediaObjectKey;
  const directory = await mkdtemp(join(tmpdir(), 'vozzify-private-track-'));
  try {
    const sourcePath = join(directory, 'source.audio');
    const wavPath = join(directory, 'music.wav');
    await convertSource(track, integrations, { sourcePath, wavPath });
    const key = privateTrackMediaKey(track.userId, track.id);
    await integrations.storage.putPrivateFile({
      key,
      filePath: wavPath,
      contentType: 'audio/wav',
    });
    const saved = await tracks.saveMusicMedia(track, key);
    return saved ? key : null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function convertSource(
  track: OwnedPrivateTrack,
  integrations: PrivateTrackProcessingIntegrations,
  { sourcePath, wavPath }: { sourcePath: string; wavPath: string },
): Promise<void> {
  if (!track.youtubeVideoId) {
    await integrations.storage.downloadPrivateFile(track.objectKey, sourcePath);
    await integrations.ffmpeg.convertPrivateAudioFileToWav(sourcePath, wavPath);
    return;
  }
  await integrations.audioDownload.downloadToFile(
    track.youtubeVideoId,
    sourcePath,
  );
  const duration = await integrations.ffmpeg.validateYouTubeAudioFile(
    sourcePath,
    PRIVATE_AUDIO_MAX_DURATION_SECONDS,
  );
  if (duration <= 0) throw new Error('The YouTube audio has no duration');
  await integrations.ffmpeg.convertPrivateAudioFileToWav(sourcePath, wavPath, {
    durationLimitSeconds: PRIVATE_AUDIO_MAX_DURATION_SECONDS,
    normalizeTimestamps: true,
  });
}
