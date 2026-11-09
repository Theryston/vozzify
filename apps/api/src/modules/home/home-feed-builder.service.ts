import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  HomeAlbum,
  HomeArtist,
  HomeGenreTile,
  HomeRow,
  HomeRowTitle,
  HomeTrack,
  Locale,
} from '@vozzify/contracts';
import type { HomeAlbumCandidateSnapshot } from './home-album-candidates.js';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import { type StoredHomeFeed } from './home-feed.js';
import { composeEntityRows } from './home-feed-composer.js';
import { composePublicRows } from './home-row-composition.js';
import {
  HOME_ENTITY_ROW_SOURCES,
  HOME_ROW_SOURCES,
  type HomeAlbumCandidate,
  type HomeArtistCandidate,
  type HomeCandidate,
  type HomeEntityRowSource,
  type HomeGenreCandidate,
  type HomeRowSource,
} from './home-row-sources.js';
import {
  DEFAULT_HOME_LOCALE,
  HOME_ALGORITHM_VERSION,
  type HomeLayout,
} from './home-rules.js';

type ComposedRow = {
  id: string;
  layout: HomeLayout;
  title?: HomeRowTitle;
  items: HomeCandidate[];
};

type ComposedEntityRow =
  | {
      id: string;
      layout: 'genres';
      title: HomeRowTitle;
      items: HomeGenreCandidate[];
    }
  | {
      id: string;
      layout: 'artists';
      title: HomeRowTitle;
      items: HomeArtistCandidate[];
    }
  | {
      id: string;
      layout: 'albums';
      title: HomeRowTitle;
      items: HomeAlbumCandidate[];
      albumCandidates?: HomeAlbumCandidateSnapshot[];
    };

export const toHomeTrack = (candidate: HomeCandidate): HomeTrack => ({
  id: candidate.id,
  title: candidate.title,
  coverUrl: candidate.coverUrl,
  // Only the public name and join phrase: the artist MBID stays server-side.
  artistCredit: candidate.artistCredit.map(({ name, joinPhrase }) => ({
    name,
    joinPhrase,
  })),
  durationMs: candidate.durationMs,
  vocalRange: candidate.vocalRange,
});

const toHomeRow = (row: ComposedRow): HomeRow | undefined => {
  if (row.layout === 'hero') {
    const [track] = row.items;
    return track
      ? { id: row.id, layout: 'hero', track: toHomeTrack(track) }
      : undefined;
  }
  if (row.layout === 'vocal-range') {
    // The composer kept only Tracks with a stored range; the filter below
    // only narrows the type for the contract, which requires a range.
    const items = row.items.flatMap((candidate) =>
      candidate.vocalRange === null
        ? []
        : [{ ...toHomeTrack(candidate), vocalRange: candidate.vocalRange }],
    );
    return row.title
      ? { id: row.id, layout: 'vocal-range', title: row.title, items }
      : undefined;
  }
  if (row.layout === 'ranked') {
    return row.title
      ? {
          id: row.id,
          layout: 'ranked',
          title: row.title,
          items: row.items.map(toHomeTrack),
        }
      : undefined;
  }
  if (row.layout !== 'standard') {
    return undefined;
  }
  return row.title
    ? {
        id: row.id,
        layout: 'standard',
        title: row.title,
        items: row.items.map(toHomeTrack),
      }
    : undefined;
};

const toHomeGenreTile = (candidate: HomeGenreCandidate): HomeGenreTile => ({
  name: candidate.name,
});

const toHomeArtist = (candidate: HomeArtistCandidate): HomeArtist => ({
  id: candidate.id,
  name: candidate.name,
});

const toHomeAlbum = (candidate: HomeAlbumCandidate): HomeAlbum => ({
  id: candidate.id,
  title: candidate.title,
  coverArtUrl: candidate.coverArtUrl,
  year: candidate.year,
});

/**
 * An entity row as the contract reads it. The `sponsored` flag is absent:
 * only editorial pins (a later slice) set it, never the algorithm.
 */
const toHomeEntityRow = (row: ComposedEntityRow): HomeRow => {
  switch (row.layout) {
    case 'genres':
      return {
        id: row.id,
        layout: 'genres',
        title: row.title,
        items: row.items.map(toHomeGenreTile),
      };
    case 'artists':
      return {
        id: row.id,
        layout: 'artists',
        title: row.title,
        items: row.items.map(toHomeArtist),
      };
    case 'albums':
      return {
        id: row.id,
        layout: 'albums',
        title: row.title,
        items: row.items.map(toHomeAlbum),
      };
  }
};

/**
 * The version of a feed is a hash of its locale, its content and the algorithm
 * that made it: an unchanged feed keeps its version, so its cursors stay valid
 * and the web is not revalidated for nothing. The locale is in the hash, so
 * the version alone names one locale's feed.
 */
const feedVersion = (
  locale: Locale,
  rows: HomeRow[],
  compositionCandidates: HomeCompositionCandidateRow[],
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        algorithmVersion: HOME_ALGORITHM_VERSION,
        locale,
        rows,
        compositionCandidates,
      }),
    )
    .digest('hex')
    .slice(0, 16);

/** Loads one locale's candidate rows, composes them and returns its public feed. */
@Injectable()
export class HomeFeedBuilder {
  constructor(
    @Inject(HOME_ROW_SOURCES) private readonly sources: HomeRowSource[],
    // Optional only so the feed can be built without the entity sources (the
    // builder specs provide the Track sources alone). HomeModule always
    // provides them.
    @Optional()
    @Inject(HOME_ENTITY_ROW_SOURCES)
    private readonly entitySources?: HomeEntityRowSource[],
  ) {}

  async build(locale: Locale = DEFAULT_HOME_LOCALE): Promise<StoredHomeFeed> {
    const composed = await composePublicRows(this.sources, locale);
    const rows = composed.rows
      .map(toHomeRow)
      .filter((row): row is HomeRow => row !== undefined);
    const entityCandidates = await Promise.all(
      (this.entitySources ?? []).map(async (source) => {
        switch (source.layout) {
          case 'genres':
            return {
              id: source.id,
              layout: source.layout,
              title: source.title,
              items: await source.load(locale),
            };
          case 'artists':
            return {
              id: source.id,
              layout: source.layout,
              title: source.title,
              items: await source.load(locale),
            };
          case 'albums': {
            const snapshot = await source.loadSnapshot?.(locale);
            return {
              id: source.id,
              layout: source.layout,
              title: source.title,
              items: snapshot?.items ?? (await source.load(locale)),
              ...(snapshot ? { albumCandidates: snapshot.candidates } : {}),
            };
          }
        }
      }),
    );
    const albumCandidates = entityCandidates.flatMap((candidate) =>
      candidate.layout === 'albums' ? (candidate.albumCandidates ?? []) : [],
    );
    const entityRows = composeEntityRows(entityCandidates).map(toHomeEntityRow);
    return {
      audience: 'public',
      locale,
      version: feedVersion(
        locale,
        [...rows, ...entityRows],
        composed.compositionCandidates,
      ),
      algorithmVersion: HOME_ALGORITHM_VERSION,
      rows: [...rows, ...entityRows],
      compositionCandidates: composed.compositionCandidates,
      ...(albumCandidates.length > 0 ? { albumCandidates } : {}),
    };
  }
}
