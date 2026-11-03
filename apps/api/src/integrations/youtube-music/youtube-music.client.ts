import { Inject, Injectable } from '@nestjs/common';
import { Innertube, Platform, Utils } from 'youtubei.js';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { createProxiedFetch, proxyOf } from './http-proxy.js';
import { evaluatePlayerScript } from './youtube-player-evaluator.js';
import {
  type YouTubePlaybackAvailability,
  type YouTubeSearchItemLike,
  type YouTubeVideo,
  youtubeVideoOfInfo,
  youtubeVideoOfSearchItem,
} from './youtube-video.js';

const availabilitySchema = z.object({
  available_countries: z.array(z.string()),
});

/**
 * Searches, video info and playback checks share one Brazilian SDK session
 * and its configured proxy. Features depend only on plain video results.
 * The session is opened on first use, so booting makes no external request.
 */
@Injectable()
export class YouTubeMusicClient {
  private session: Promise<Innertube> | undefined;
  private readonly fetchImplementation: typeof fetch;

  constructor(@Inject(ENV) env: Env) {
    const proxy = proxyOf(env);
    this.fetchImplementation =
      proxy === undefined ? fetch : createProxiedFetch(proxy);
  }

  /**
   * Restrict searches to artist audio so title, artist and duration matching
   * does not accidentally choose a music video or live performance.
   */
  async searchSongs(query: string): Promise<YouTubeVideo[]> {
    const yt = await this.innertube();
    const results = await yt.music.search(query, { type: 'song' });
    return itemsOf(results.songs).flatMap(
      (item) => youtubeVideoOfSearchItem(item) ?? [],
    );
  }

  /** Bind every metadata and media request to the same download deadline. */
  async downloadAudio(
    videoId: string,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    signal.throwIfAborted();
    Platform.shim.eval = evaluatePlayerScript;
    const yt = await this.createSession((input, init) => {
      const requestSignal =
        init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return this.fetchImplementation(input, {
        ...init,
        signal: requestSignal
          ? AbortSignal.any([signal, requestSignal])
          : signal,
      });
    });
    return yt.download(videoId, {
      type: 'audio',
      quality: 'best',
      format: 'any',
      // ANDROID_VR URLs stop serving after about 1 MiB, even with a proxy.
      client: 'VISIONOS',
    });
  }

  /**
   * The video with this ID, or undefined when YouTube has no title for it. An
   * unavailable video makes the request fail, which the caller treats as no
   * video.
   */
  async getVideo(videoId: string): Promise<YouTubeVideo | undefined> {
    const yt = await this.innertube();
    const info = await yt.music.getInfo(videoId);
    return youtubeVideoOfInfo(videoId, info.basic_info);
  }

  /** Music search metadata does not establish browser playback eligibility. */
  async getPlaybackAvailability(
    videoId: string,
  ): Promise<YouTubePlaybackAvailability> {
    const yt = await this.innertube();
    try {
      const info = await yt.getBasicInfo(videoId, { client: 'WEB' });
      assertNoBotChallenge(info.playability_status);
      if (
        info.playability_status?.status !== 'OK' ||
        !info.playability_status.embeddable
      ) {
        return null;
      }
      const availability = availabilitySchema.safeParse(
        info.page?.[0]?.microformat,
      );
      if (!availability.success) {
        throw new Error('YouTube did not return video availability countries');
      }
      return playbackAvailabilityOf(availability.data.available_countries);
    } catch (error) {
      // The SDK throws for ERROR before returning the playability status.
      // Transport and parser failures must still reach the pipeline's retries.
      const detail: unknown =
        error instanceof Utils.InnertubeError ? error.info : undefined;
      assertNoBotChallenge(detail);
      if (
        typeof detail === 'object' &&
        detail !== null &&
        'status' in detail &&
        detail.status === 'ERROR'
      ) {
        return null;
      }
      throw error;
    }
  }

  private innertube(): Promise<Innertube> {
    this.session ??= this.createSession(this.fetchImplementation).catch(
      (error: unknown) => {
        // A failed session is retried on the next request, not kept.
        this.session = undefined;
        throw error;
      },
    );
    return this.session;
  }

  private createSession(fetchImplementation: typeof fetch): Promise<Innertube> {
    return Innertube.create({
      // Country context guides discovery; playback is checked separately.
      location: 'BR',
      // The SDK identifies result shelves by their English names.
      lang: 'en',
      // WEB playback checks require the player's signature timestamp.
      retrieve_player: true,
      fetch: fetchImplementation,
    });
  }
}

const itemsOf = (
  shelf: { contents?: readonly YouTubeSearchItemLike[] } | undefined,
): readonly YouTubeSearchItemLike[] => shelf?.contents ?? [];

function playbackAvailabilityOf(
  countries: readonly string[],
): YouTubePlaybackAvailability {
  const brazil = countries.includes('BR');
  const usa = countries.includes('US');
  if (brazil && usa) return 'both';
  if (brazil) return 'BR';
  return usa ? 'US' : null;
}

function assertNoBotChallenge(value: unknown): void {
  if (
    typeof value === 'object' &&
    value !== null &&
    'reason' in value &&
    typeof value.reason === 'string' &&
    value.reason.toLowerCase().includes('not a bot')
  ) {
    throw new Error(
      'YouTube blocked the playback availability check with bot verification',
    );
  }
}
