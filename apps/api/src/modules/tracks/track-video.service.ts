import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TrackProcessingVideoSource } from '@vozzify/contracts';
import { ENV, type Env } from '../../config/env.js';
import { YouTubeMusicClient } from '../../integrations/youtube-music/youtube-music.client.js';
import type { YouTubeVideo } from '../../integrations/youtube-music/youtube-video.js';
import { trackLimitsFrom } from './track-limits.js';
import {
  messageOf,
  TrackProcessingFailure,
} from './track-processing-failure.js';
import type { PipelineTrack } from './track-repository.helpers.js';
import {
  chooseSearchMatch,
  isValidCandidate,
  type RecordingTarget,
  recordingTargetOf,
  searchQueryOf,
} from './track-video-matching.js';
import { youtubeVideoIdOf } from './youtube-video-id.js';

/** The video a Processing chose, and where it was found. */
export type ChosenVideo = {
  videoId: string;
  source: TrackProcessingVideoSource;
};

/** The video a finding chose. */
export type VideoFinding = {
  video: ChosenVideo;
};

type FoundVideo = { video: YouTubeVideo; source: TrackProcessingVideoSource };

/**
 * Finds the YouTube video the timeline will play (ADR 0004): the Recording's
 * own YouTube link when it matches, else the best YouTube Music search result.
 * The length limit is checked before any search, so a Recording too long costs
 * nothing. A playable linked video needs no search: the cover uses its own
 * catalog release or that chosen video's thumbnail.
 */
@Injectable()
export class TrackVideoService {
  private readonly logger = new Logger(TrackVideoService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly youtube: YouTubeMusicClient,
  ) {}

  /**
   * @throws {TrackProcessingFailure} `TOO_LONG` when the Recording, or the
   * chosen video of a Recording with no length, is over the limit;
   * `VIDEO_NOT_FOUND` when no candidate matches.
   */
  async findVideo(track: PipelineTrack): Promise<VideoFinding> {
    const target = recordingTargetOf(track);
    if (track.lengthMs !== null) {
      this.assertWithinMaxDuration(track.lengthMs / 1000);
    }
    const linked = await this.findLinkedVideo(target, track.externalUrls);
    const found = linked ?? foundBySearch(await this.searchBestMatch(target));
    if (track.lengthMs === null) {
      this.assertWithinMaxDuration(found.video.durationSeconds);
    }
    return {
      video: { videoId: found.video.videoId, source: found.source },
    };
  }

  /** The first of the Recording's YouTube links whose video matches it. */
  private async findLinkedVideo(
    target: RecordingTarget,
    externalUrls: readonly string[],
  ): Promise<FoundVideo | undefined> {
    for (const videoId of youtubeVideoIdsOf(externalUrls)) {
      const video = await this.lookUp(videoId);
      if (
        video !== undefined &&
        isValidCandidate(target, video) &&
        (await this.youtube.canPlayVideo(videoId))
      ) {
        return { video, source: 'musicbrainz' };
      }
    }
    return undefined;
  }

  /** Trust hosted search results; only reconcile their metadata locally. */
  private async searchBestMatch(
    target: RecordingTarget,
  ): Promise<YouTubeVideo | undefined> {
    const results = await this.youtube.searchSongs(searchQueryOf(target));
    return chooseSearchMatch(target, results);
  }

  /**
   * A linked video that cannot be read is no candidate: the search is still
   * there, so the link is skipped rather than failing the Processing.
   */
  private async lookUp(videoId: string): Promise<YouTubeVideo | undefined> {
    try {
      return await this.youtube.getVideo(videoId);
    } catch (error) {
      this.logger.warn(
        `Could not read the linked YouTube video ${videoId}: ${messageOf(error)}`,
      );
      return undefined;
    }
  }

  private assertWithinMaxDuration(seconds: number | null): void {
    if (seconds !== null && seconds > this.maxDurationSeconds()) {
      throw new TrackProcessingFailure('TOO_LONG');
    }
  }

  /** The limit the env sets, or the default of `track-limits.ts` when unset. */
  private maxDurationSeconds(): number {
    return trackLimitsFrom(this.env).maxDurationSeconds;
  }
}

/** The best search result as the chosen video; no match is a failure. */
function foundBySearch(best: YouTubeVideo | undefined): FoundVideo {
  if (best === undefined) {
    throw new TrackProcessingFailure('VIDEO_NOT_FOUND');
  }
  return { video: best, source: 'youtube_music' };
}

/** The distinct YouTube video IDs the URLs name, in the order given. */
function youtubeVideoIdsOf(urls: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const url of urls) {
    const id = youtubeVideoIdOf(url);
    if (id !== undefined) {
      ids.add(id);
    }
  }
  return [...ids];
}
