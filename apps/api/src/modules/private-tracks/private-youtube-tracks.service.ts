import { Injectable } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import {
  PRIVATE_AUDIO_MAX_DURATION_SECONDS,
  type PrivateTrack,
} from '@vozzify/contracts';
import { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';
import { ZodValidationException } from '../../common/zod/zod-validation.pipe.js';
import { YouTubeMusicClient } from '../../integrations/youtube-music/youtube-music.client.js';
import { youtubeVideoIdOf } from '../../integrations/youtube-music/youtube-video-id.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { privateTrackMediaKey } from './private-track-object-keys.js';
import { PrivateTracksRepository } from './private-tracks.repository.js';
import { toPrivateTrack } from './private-tracks.service.js';

@Injectable()
export class PrivateYouTubeTracksService {
  constructor(
    private readonly tracks: PrivateTracksRepository,
    private readonly membership: SubscriptionMembershipService,
    private readonly youtube: YouTubeMusicClient,
  ) {}

  async submit(userId: string, url: string): Promise<PrivateTrack> {
    if (!(await this.membership.hasPaidMembership(userId))) {
      throw new AppException('FORBIDDEN', 'A Pro membership is required');
    }
    const videoId = youtubeVideoIdOf(url);
    if (!videoId) {
      throw invalidYouTubeUrl('Use an individual YouTube video URL');
    }
    const existing = await this.tracks.findOwnedYouTube(userId, videoId);
    if (existing) return toPrivateTrack(existing);

    const { title, durationMs } = await this.lookupVideo(videoId);
    const id = createId();
    const row = await this.tracks.reserveYouTube({
      id,
      userId,
      youtubeVideoId: videoId,
      objectKey: privateTrackMediaKey(userId, id),
      originalFilename: '',
      title,
      durationMs,
    });
    return toPrivateTrack(row);
  }

  private async lookupVideo(videoId: string) {
    const video = await this.youtube.getPracticeVideo(videoId).catch(() => {
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'Could not read YouTube video details',
      );
    });
    const title = video?.title.trim();
    const duration = video?.durationSeconds;
    if (
      !title ||
      !duration ||
      !Number.isFinite(duration) ||
      duration < 0.001 ||
      duration > PRIVATE_AUDIO_MAX_DURATION_SECONDS
    ) {
      throw invalidYouTubeUrl(
        'Use an available YouTube video no longer than 30 minutes',
      );
    }
    return { title, durationMs: Math.round(duration * 1000) };
  }
}

function invalidYouTubeUrl(message: string) {
  return new ZodValidationException(
    new z.ZodError([{ code: 'custom', path: ['url'], message }]),
    'body',
  );
}
