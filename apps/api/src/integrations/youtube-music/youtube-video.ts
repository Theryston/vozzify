// A YouTube video as the API sees it, mapped from what YouTube Music answers
// (pure). Only this file knows the SDK's shapes: features get these plain
// objects, so they can be tested and replaced without the SDK.

/** What YouTube lists the video as: a song (artist audio), a video, or other. */
type YouTubeVideoKind = 'song' | 'video' | 'other';

/** Country coverage for a playable candidate; null excludes both markets. */
export type YouTubePlaybackAvailability = 'both' | 'BR' | 'US' | null;

export type YouTubeVideo = {
  videoId: string;
  title: string;
  /** Artist names as YouTube lists them; a channel's name for a plain video. */
  artists: string[];
  /** Length in seconds; null when YouTube does not say. */
  durationSeconds: number | null;
  kind: YouTubeVideoKind;
  /** The largest artwork YouTube gives, or null. */
  artworkUrl: string | null;
};

type ImageLike = { url: string; width: number };

/** The item shape a music search answers with, as far as it is read. */
export type YouTubeSearchItemLike = {
  id?: string;
  title?: string;
  artists?: readonly { name: string }[];
  duration?: { seconds: number };
  item_type?: string;
  thumbnails: readonly ImageLike[];
};

/** The basic info of a video, as `getInfo` answers it, as far as it is read. */
export type YouTubeVideoInfoLike = {
  title?: string;
  duration?: number;
  author?: string;
  thumbnail?: readonly ImageLike[];
};

const kindOf = (itemType: string | undefined): YouTubeVideoKind => {
  if (itemType === 'song') {
    return 'song';
  }
  return itemType === 'video' ? 'video' : 'other';
};

/** A length YouTube gives as a positive number of seconds, else null. */
const durationOf = (seconds: number | undefined): number | null =>
  seconds !== undefined && seconds > 0 ? seconds : null;

/** The widest image's URL, or null when there is none. */
const largestUrl = (images: readonly ImageLike[]): string | null => {
  let largest: ImageLike | undefined;
  for (const image of images) {
    if (largest === undefined || image.width > largest.width) {
      largest = image;
    }
  }
  return largest?.url ?? null;
};

/** A search result as a video; undefined for one without an ID or a title. */
export function youtubeVideoOfSearchItem(
  item: YouTubeSearchItemLike,
): YouTubeVideo | undefined {
  if (item.id === undefined || item.title === undefined) {
    return undefined;
  }
  return {
    videoId: item.id,
    title: item.title,
    artists: (item.artists ?? []).map((artist) => artist.name),
    durationSeconds: durationOf(item.duration?.seconds),
    kind: kindOf(item.item_type),
    artworkUrl: largestUrl(item.thumbnails),
  };
}

/** The video of a `getInfo` answer; undefined when it has no title. */
export function youtubeVideoOfInfo(
  videoId: string,
  info: YouTubeVideoInfoLike,
): YouTubeVideo | undefined {
  if (info.title === undefined) {
    return undefined;
  }
  return {
    videoId,
    title: info.title,
    artists: info.author === undefined ? [] : [info.author],
    durationSeconds: durationOf(info.duration),
    kind: 'other',
    artworkUrl: largestUrl(info.thumbnail ?? []),
  };
}
