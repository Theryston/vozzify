import 'server-only';

import {
  cacheTags,
  type TrackDetail,
  type TrackLyrics,
  type TrackNotes,
  trackDetailSchema,
  trackLyricsSchema,
  trackNotesSchema,
} from '@vozzify/contracts';
import { cacheLife, cacheTag } from 'next/cache';

import { serverApi } from '@/lib/api/server';

/**
 * The practice header of a Track. The page only asks once the Processing has
 * completed. The API revalidates the Track's tag on catalog changes. The
 * bounded life keeps the displayed Contributors' identities fresh as well.
 */
async function getTrackDetail(trackId: string): Promise<TrackDetail> {
  'use cache';
  cacheTag(cacheTags.track(trackId));
  cacheLife({ stale: 30, revalidate: 60, expire: 300 });

  return serverApi(`/tracks/${encodeURIComponent(trackId)}`, {
    schema: trackDetailSchema,
  });
}

/** The vocal notes of a Track in sung order, cached under their own tag. */
async function getTrackNotes(trackId: string): Promise<TrackNotes> {
  'use cache';
  cacheTag(cacheTags.trackNotes(trackId));
  cacheLife('max');

  return serverApi(`/tracks/${encodeURIComponent(trackId)}/notes`, {
    schema: trackNotesSchema,
  });
}

/** The Timed lyrics of a Track, cached under their own tag. */
async function getTrackLyrics(trackId: string): Promise<TrackLyrics> {
  'use cache';
  cacheTag(cacheTags.trackLyrics(trackId));
  cacheLife('max');

  return serverApi(`/tracks/${encodeURIComponent(trackId)}/lyrics`, {
    schema: trackLyricsSchema,
  });
}

/** What the server renders the practice view from. */
export type InitialPractice = {
  header: TrackDetail;
  notes: TrackNotes | undefined;
  /** Undefined when the lyrics were not read; the browser then asks. */
  lyrics?: TrackLyrics;
};

/**
 * The header and the notes for the first render, or undefined when the API
 * fails: the page then shows the practice view's own loading and error states
 * instead of failing whole, since the browser can read both on its own.
 */
export async function getInitialPractice(
  trackId: string,
): Promise<InitialPractice | undefined> {
  try {
    // `/notes` answers an empty list for an instrumental Track, so both are
    // read at once instead of the notes waiting for the header.
    const [header, notes] = await Promise.all([
      getTrackDetail(trackId),
      getTrackNotes(trackId),
    ]);
    return { header, notes: header.hasNotes ? notes : undefined };
  } catch {
    return undefined;
  }
}

/**
 * What the Track route renders the practice view from: the header and notes,
 * and the lyrics, read at once. The lyrics are a bonus and never fail the rest.
 */
export async function getInitialPracticeWithLyrics(
  trackId: string,
): Promise<InitialPractice | undefined> {
  const [practice, lyrics] = await Promise.all([
    getInitialPractice(trackId),
    getInitialLyrics(trackId),
  ]);
  return practice && { ...practice, lyrics };
}

/**
 * The Timed lyrics for the first render, or undefined when the API fails: they
 * are a bonus, so the page keeps rendering and the browser asks again.
 */
async function getInitialLyrics(
  trackId: string,
): Promise<TrackLyrics | undefined> {
  try {
    return await getTrackLyrics(trackId);
  } catch {
    return undefined;
  }
}
