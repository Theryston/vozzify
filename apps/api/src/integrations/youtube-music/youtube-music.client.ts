import { Inject, Injectable } from '@nestjs/common';
import { Innertube, Utils } from 'youtubei.js';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { brightDataProxyOf, createProxiedFetch } from './bright-data-proxy.js';
import {
  type YouTubePlaybackAvailability,
  type YouTubeVideo,
  youtubeVideoOfInfo,
  youtubeVideoOfSearchItem,
} from './youtube-video.js';

const SEARCH_URL = 'https://j2v0n2sold.execute-api.us-east-1.amazonaws.com/';
const SEARCH_TIMEOUT_MS = 30_000;
const availabilitySchema = z.object({
  available_countries: z.array(z.string()),
});
const searchResponseSchema = z.array(
  z.object({
    videoId: z.string().nullish(),
    title: z.string().nullish(),
    artists: z.array(z.object({ name: z.string() })).nullish(),
    duration_seconds: z.number().nullish(),
    resultType: z.string().nullish(),
    thumbnails: z
      .array(z.object({ url: z.string(), width: z.number() }))
      .nullish(),
  }),
);

/**
 * Searches through notefinder's hosted service. Video info and browser
 * playback checks use the SDK; features depend on these plain video results.
 * The SDK session is opened on first use, so searches need no YouTube session.
 */
@Injectable()
export class YouTubeMusicClient {
  private session: Promise<Innertube> | undefined;
  private readonly fetchImplementation: typeof fetch;

  constructor(@Inject(ENV) env: Env) {
    const proxy = brightDataProxyOf(env);
    this.fetchImplementation =
      proxy === undefined ? fetch : createProxiedFetch(proxy);
  }

  /**
   * Uses the legacy caller's complete parameter set: the hosted service
   * fails when called with only the query. This request bypasses the proxy.
   */
  async searchSongs(query: string): Promise<YouTubeVideo[]> {
    const url = new URL(SEARCH_URL);
    url.search = new URLSearchParams({
      query,
      filter: 'songs',
      ignore_spelling: 'false',
      limit: '30',
    }).toString();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `YouTube Music search failed with HTTP ${response.status}`,
      );
    }
    const results = searchResponseSchema.parse(await response.json());
    return results.flatMap(
      (item) =>
        youtubeVideoOfSearchItem({
          id: item.videoId ?? undefined,
          title: item.title ?? undefined,
          artists: item.artists ?? undefined,
          duration: { seconds: item.duration_seconds ?? 0 },
          item_type: item.resultType ?? undefined,
          thumbnails: item.thumbnails ?? [],
        }) ?? [],
    );
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
    this.session ??= Innertube.create({
      // WEB playback checks require the player's signature timestamp.
      retrieve_player: true,
      fetch: this.fetchImplementation,
    }).catch((error: unknown) => {
      // A failed session is retried on the next request, not kept.
      this.session = undefined;
      throw error;
    });
    return this.session;
  }
}

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
