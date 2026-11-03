import { Inject, Injectable } from '@nestjs/common';
import { Innertube, Utils } from 'youtubei.js';
import { ENV, type Env } from '../../config/env.js';
import { brightDataProxyOf, createProxiedFetch } from './bright-data-proxy.js';
import {
  type YouTubeSearchItemLike,
  type YouTubeVideo,
  youtubeVideoOfInfo,
  youtubeVideoOfSearchItem,
} from './youtube-video.js';

/**
 * The YouTube Music requests Processing makes: a song search and the basic
 * info of one video. The only code that imports `youtubei.js`; features depend
 * on this class, so tests replace it at this boundary. The session is opened
 * on first use, so booting the API makes no request.
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
   * The songs a search for the text finds, most relevant first. It is a typed
   * search: the untyped one answers a mixed list with no "songs" shelf and no
   * length on songs, which a match by duration cannot use. Only songs are
   * searched, the artist's own audio, never the videos around it.
   */
  async searchSongs(query: string): Promise<YouTubeVideo[]> {
    const yt = await this.innertube();
    const results = await yt.music.search(query, { type: 'song' });
    return itemsOf(results.songs).flatMap(
      (item) => youtubeVideoOfSearchItem(item) ?? [],
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
  async canPlayVideo(videoId: string): Promise<boolean> {
    const yt = await this.innertube();
    try {
      const info = await yt.getBasicInfo(videoId, { client: 'WEB' });
      return (
        info.playability_status?.status === 'OK' &&
        info.playability_status.embeddable
      );
    } catch (error) {
      // The SDK throws for ERROR before returning the playability status.
      // Transport and parser failures must still reach the pipeline's retries.
      const detail: unknown =
        error instanceof Utils.InnertubeError ? error.info : undefined;
      if (
        typeof detail === 'object' &&
        detail !== null &&
        'status' in detail &&
        detail.status === 'ERROR'
      ) {
        return false;
      }
      throw error;
    }
  }

  private innertube(): Promise<Innertube> {
    this.session ??= Innertube.create({
      retrieve_player: false,
      fetch: this.fetchImplementation,
    }).catch((error: unknown) => {
      // A failed session is retried on the next request, not kept.
      this.session = undefined;
      throw error;
    });
    return this.session;
  }
}

/** The result items of one shelf of a search; none when the shelf is missing. */
const itemsOf = (
  shelf: { contents?: readonly YouTubeSearchItemLike[] } | undefined,
): readonly YouTubeSearchItemLike[] => shelf?.contents ?? [];
