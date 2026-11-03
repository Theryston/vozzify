import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TrackProcessingVideoSource } from '@vozzify/contracts';
import { ENV, type Env } from '../../config/env.js';
import { YouTubeMusicClient } from '../../integrations/youtube-music/youtube-music.client.js';
import type {
  YouTubePlaybackAvailability,
  YouTubeVideo,
} from '../../integrations/youtube-music/youtube-video.js';
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

type FoundVideo = {
  video: YouTubeVideo;
  source: TrackProcessingVideoSource;
  availability: NonNullable<YouTubePlaybackAvailability>;
};
const PLAYBACK_PRIORITY = { both: 0, BR: 1, US: 2 };

/**
 * Finds the matching video with the best country coverage (ADR 0004).
 * MusicBrainz links win ties; a link available in both markets needs no search.
 * The length limit is checked first, so an overlong Recording costs nothing.
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
    const found =
      linked?.availability === 'both'
        ? linked
        : preferredVideo(linked, await this.searchBestMatch(target));
    if (found === undefined) {
      throw new TrackProcessingFailure('VIDEO_NOT_FOUND');
    }
    if (track.lengthMs === null) {
      this.assertWithinMaxDuration(found.video.durationSeconds);
    }
    return {
      video: { videoId: found.video.videoId, source: found.source },
    };
  }

  /** The matching linked video with the best country coverage. */
  private async findLinkedVideo(
    target: RecordingTarget,
    externalUrls: readonly string[],
  ): Promise<FoundVideo | undefined> {
    let best: FoundVideo | undefined;
    for (const videoId of youtubeVideoIdsOf(externalUrls)) {
      const video = await this.lookUp(videoId);
      if (video !== undefined && isValidCandidate(target, video)) {
        best = preferredVideo(
          best,
          await this.assessVideo(video, 'musicbrainz'),
        );
        if (best?.availability === 'both') return best;
      }
    }
    return best;
  }

  /** Country coverage wins first; metadata matching breaks ties within it. */
  private async searchBestMatch(
    target: RecordingTarget,
  ): Promise<FoundVideo | undefined> {
    const results = await this.youtube.searchSongs(searchQueryOf(target));
    let remaining = results;
    let best: FoundVideo | undefined;
    while (true) {
      const candidate = chooseSearchMatch(target, remaining);
      if (candidate === undefined) return best;
      const assessed = await this.assessVideo(candidate, 'youtube_music');
      best = preferredVideo(best, assessed);
      if (best?.availability === 'both') return best;
      if (assessed === undefined) {
        this.logger.warn(
          `Skipping unavailable YouTube video ${candidate.videoId}`,
        );
      }
      remaining = remaining.filter(
        (item) => item.videoId !== candidate.videoId,
      );
    }
  }

  private async assessVideo(
    video: YouTubeVideo,
    source: TrackProcessingVideoSource,
  ): Promise<FoundVideo | undefined> {
    const availability = await this.youtube.getPlaybackAvailability(
      video.videoId,
    );
    return availability === null ? undefined : { video, source, availability };
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

/** Keep the earlier metadata match or linked source when country tiers tie. */
function preferredVideo(
  current: FoundVideo | undefined,
  candidate: FoundVideo | undefined,
): FoundVideo | undefined {
  if (candidate === undefined) return current;
  if (
    current === undefined ||
    PLAYBACK_PRIORITY[candidate.availability] <
      PLAYBACK_PRIORITY[current.availability]
  ) {
    return candidate;
  }
  return current;
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
