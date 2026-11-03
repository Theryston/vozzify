import type { YouTubeVideo } from '../../src/integrations/youtube-music/youtube-video.js';

/** A YouTube video with the Recording's own length and artist by default. */
export const youtubeVideo = (
  overrides: Partial<YouTubeVideo> = {},
): YouTubeVideo => ({
  videoId: 'bbbbbbbbbbb',
  title: 'Queen - Bohemian Rhapsody (Official Video)',
  artists: ['Queen'],
  durationSeconds: 354,
  kind: 'song',
  artworkUrl: null,
  ...overrides,
});

/**
 * YouTube Music, faked at its integration boundary for the e2e specs: a search
 * answers `results`, a lookup answers the video set for its ID. Every call is
 * recorded, so a spec asserts what was asked and what was not.
 */
export class FakeYouTubeMusic {
  /** What every search answers. */
  results: YouTubeVideo[] = [];
  /** The answer of a lookup per video ID; an error answer is thrown. */
  videos = new Map<string, YouTubeVideo | Error>();
  /** When set, every search fails with it: YouTube is down. */
  searchFailure: Error | undefined;
  readonly searches: string[] = [];
  readonly lookups: string[] = [];

  /** Back to the answers of a fresh fake, with no calls recorded. */
  reset(): void {
    this.results = [youtubeVideo()];
    this.videos = new Map();
    this.searchFailure = undefined;
    this.searches.length = 0;
    this.lookups.length = 0;
  }

  async searchSongs(query: string): Promise<YouTubeVideo[]> {
    this.searches.push(query);
    if (this.searchFailure !== undefined) {
      throw this.searchFailure;
    }
    return this.results;
  }

  async getVideo(videoId: string): Promise<YouTubeVideo | undefined> {
    this.lookups.push(videoId);
    const answer = this.videos.get(videoId);
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  }

  async canPlayVideo(_videoId: string): Promise<boolean> {
    return true;
  }
}
