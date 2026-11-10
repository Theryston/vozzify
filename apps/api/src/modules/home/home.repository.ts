import { Inject, Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Locale } from '@vozzify/contracts';
import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { albums, albumTracks } from '../../database/schema/albums.js';
import { artists, trackArtists } from '../../database/schema/artists.js';
import { hasCompletedProcessing } from '../../database/schema/track-processings.js';
import { tracks } from '../../database/schema/tracks.js';
import type { TrackSignalCount } from './home-popularity.js';
import {
  type HomeAlbumTrackSignal,
  HomePopularityRepository,
} from './home-popularity.repository.js';

/** A Track as the home's candidate queries read it. */
export type HomeTrackRecord = {
  id: string;
  title: string;
  coverUrl: string | null;
  artistCredit: { name: string; joinPhrase: string; mbid?: string }[];
  lengthMs: number | null;
  vocalRangeLowest: number | null;
  vocalRangeHighest: number | null;
  /**
   * The views-based trending score, read with the record so the weekly Top 10
   * can blend it with the singing signal. Sources that don't rank by it leave
   * it out, so it is optional and defaults to 0 where it is read.
   */
  trendingScore?: number;
};

/** A genre and how many completed Tracks carry it. */
export type HomeGenreRecord = { genre: string; trackCount: number };

/** An Artist with at least one completed Track. */
export type HomeArtistRecord = { id: string; name: string };

/** An Album with at least one completed Track, and its header fields. */
export type HomeAlbumRecord = {
  id: string;
  title: string;
  coverArtUrl: string | null;
  year: number | null;
  primaryType?: string | null;
  secondaryTypes?: string[];
};

const candidateColumns = {
  id: tracks.id,
  title: tracks.title,
  coverUrl: tracks.coverUrl,
  artistCredit: tracks.artistCredit,
  lengthMs: tracks.lengthMs,
  vocalRangeLowest: tracks.vocalRangeLowest,
  vocalRangeHighest: tracks.vocalRangeHighest,
  trendingScore: tracks.trendingScore,
};

/**
 * The Tracks the home can show: only Tracks whose Processing completed
 * (ADR 0005). The queries read a bounded list, best first; the composer
 * decides the rest.
 */
@Injectable()
export class HomeRepository {
  constructor(
    private readonly txHost: TransactionHost<DatabaseAdapter>,
    @Inject(HomePopularityRepository)
    private readonly popularity: HomePopularityRepository,
  ) {}

  /** Completed Tracks with a trending score, hottest first. */
  findTrendingTracks(limit: number, offset = 0): Promise<HomeTrackRecord[]> {
    return this.txHost.tx
      .select(candidateColumns)
      .from(tracks)
      .where(
        and(hasCompletedProcessing(tracks.id), gt(tracks.trendingScore, 0)),
      )
      .orderBy(desc(tracks.trendingScore), asc(tracks.id))
      .limit(limit)
      .offset(offset);
  }

  /** The completed Tracks among `ids`, in no particular order. */
  findCompletedTracksByIds(ids: string[]): Promise<HomeTrackRecord[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.txHost.tx
      .select(candidateColumns)
      .from(tracks)
      .where(and(hasCompletedProcessing(tracks.id), inArray(tracks.id, ids)));
  }

  /**
   * The catalog IDs of the artists the MBIDs name. Credits stored without an
   * MBID, or whose MBID has no Artist yet, have no row here, so their names
   * stay unlinked.
   */
  findArtistIdsByMbids(
    mbids: string[],
  ): Promise<{ mbid: string; id: string }[]> {
    if (mbids.length === 0) {
      return Promise.resolve([]);
    }
    return this.txHost.tx
      .select({ mbid: artists.mbid, id: artists.id })
      .from(artists)
      .where(inArray(artists.mbid, mbids));
  }

  /** Completed Tracks with a stored Vocal range, hottest first. */
  findTracksWithVocalRange(
    limit: number,
    offset = 0,
  ): Promise<HomeTrackRecord[]> {
    return this.txHost.tx
      .select(candidateColumns)
      .from(tracks)
      .where(
        and(
          hasCompletedProcessing(tracks.id),
          isNotNull(tracks.vocalRangeLowest),
          isNotNull(tracks.vocalRangeHighest),
        ),
      )
      .orderBy(desc(tracks.trendingScore), asc(tracks.id))
      .limit(limit)
      .offset(offset);
  }

  /** Completed Tracks, newest first. */
  findNewestTracks(limit: number, offset = 0): Promise<HomeTrackRecord[]> {
    return this.txHost.tx
      .select(candidateColumns)
      .from(tracks)
      .where(hasCompletedProcessing(tracks.id))
      .orderBy(desc(tracks.createdAt), desc(tracks.id))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Completed Tracks by distinct-singer weighted valid Attempts. Each User's
   * first run contributes one and repeats have a capped diminishing bonus.
   */
  findMostSungTrackIds(
    limit: number,
    since: Date,
    locale?: 'en' | 'pt-BR',
    offset = 0,
  ): Promise<TrackSignalCount[]> {
    return this.popularity.findMostSungTrackIds(limit, since, locale, offset);
  }

  async localePracticeEvidence(
    locale: 'en' | 'pt-BR',
    since: Date,
  ): Promise<{ distinctUsers: number; activeDays: number }> {
    return this.popularity.localePracticeEvidence(locale, since);
  }

  popularityScoresForTracks(
    trackIds: string[],
    since: Date,
    locale?: Locale,
    localeViewScores?: ReadonlyMap<string, number>,
  ) {
    return this.popularity.popularityScoresForTracks(
      trackIds,
      since,
      locale,
      localeViewScores,
    );
  }

  /**
   * The genres of the completed Tracks, with how many Tracks carry each one,
   * most Tracks first. A Track that lists a genre twice counts once.
   */
  findGenreTrackCounts(limit: number): Promise<HomeGenreRecord[]> {
    const genre = sql<string>`unnest(${tracks.genres})`;
    const trackCount = sql`count(distinct ${tracks.id})`;
    return this.txHost.tx
      .select({ genre, trackCount: sql<number>`${trackCount}::int` })
      .from(tracks)
      .where(hasCompletedProcessing(tracks.id))
      .groupBy(genre)
      .orderBy(desc(trackCount), asc(genre))
      .limit(limit);
  }

  /**
   * Completed Tracks by favorites since `since`, most favorited first. Ties
   * keep Track id order, like the sung row.
   */
  findMostFavoritedTrackIds(
    limit: number,
    since: Date,
    offset = 0,
  ): Promise<TrackSignalCount[]> {
    return this.popularity.findMostFavoritedTrackIds(limit, since, offset);
  }

  /** Valid Attempts since `since` of the given Tracks, one row per Track. */
  countRecentAttempts(
    trackIds: string[],
    since: Date,
    locale?: 'en' | 'pt-BR',
  ): Promise<TrackSignalCount[]> {
    return this.popularity.countRecentAttempts(trackIds, since, locale);
  }

  /** Favorites since `since` of the given Tracks, one row per Track. */
  countRecentFavorites(
    trackIds: string[],
    since: Date,
  ): Promise<TrackSignalCount[]> {
    return this.popularity.countRecentFavorites(trackIds, since);
  }

  /**
   * The Artists with a completed Track, most popular first: the sum of their
   * completed Tracks' trending scores, then the ID.
   */
  findPopularArtists(limit: number): Promise<HomeArtistRecord[]> {
    return this.txHost.tx
      .select({ id: artists.id, name: artists.name })
      .from(artists)
      .innerJoin(trackArtists, eq(trackArtists.artistId, artists.id))
      .innerJoin(tracks, eq(tracks.id, trackArtists.trackId))
      .where(hasCompletedProcessing(tracks.id))
      .groupBy(artists.id, artists.name)
      .orderBy(desc(sql`sum(${tracks.trendingScore})`), asc(artists.id))
      .limit(limit);
  }

  /**
   * A bounded page of Albums with completed Tracks, ordered by existing
   * popularity before content-aware selection.
   */
  findPopularAlbums(limit: number, offset = 0): Promise<HomeAlbumRecord[]> {
    return this.txHost.tx
      .select({
        id: albums.id,
        title: albums.title,
        coverArtUrl: albums.coverArtUrl,
        year: albums.year,
        primaryType: albums.primaryType,
        secondaryTypes: albums.secondaryTypes,
      })
      .from(albums)
      .innerJoin(albumTracks, eq(albumTracks.albumId, albums.id))
      .innerJoin(tracks, eq(tracks.id, albumTracks.trackId))
      .where(hasCompletedProcessing(tracks.id))
      .groupBy(albums.id)
      .orderBy(desc(sql`sum(${tracks.trendingScore})`), asc(albums.id))
      .limit(limit)
      .offset(offset);
  }

  /** Available Track scores for one bounded candidate batch. */
  async findAlbumTrackSignals(
    albumIds: string[],
    locale?: Locale,
    localeViewScores: readonly { trackId: string; score: number }[] = [],
  ): Promise<HomeAlbumTrackSignal[]> {
    return this.popularity.findAlbumTrackSignals(
      albumIds,
      locale,
      localeViewScores,
    );
  }
}
