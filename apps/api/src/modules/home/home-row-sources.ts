import type { HomeRowTitle, HomeTrack, Locale } from '@vozzify/contracts';
import type { HomeRepository, HomeTrackRecord } from './home.repository.js';
import {
  type HomeAlbumCandidateSnapshot,
  loadUsefulAlbumSnapshot,
} from './home-album-candidates.js';
import { homeArtistKeys } from './home-artist-keys.js';
import type {
  ComposableEntity,
  ComposableTrack,
} from './home-feed-composer.js';
import { SINGING_SIGNAL_WINDOW_DAYS } from './home-popularity.js';
import {
  CANDIDATE_LIMIT,
  type HomeRecords,
  localeTrending,
  rankedHomeRecords,
  type TrendingRanking,
  weeklyTop10,
  windowSince,
} from './home-row-source-ranking.js';
import {
  DEFAULT_HOME_LOCALE,
  type HomeLayout,
  MIN_TRACKS_PER_GENRE,
} from './home-rules.js';
import { hasSufficientLocaleEvidence } from './home-stage2-scoring.js';

/** Injection token of the row sources the builder composes, in feed order. */
export const HOME_ROW_SOURCES = Symbol('HOME_ROW_SOURCES');

/** The artist credit with the MBID the artist cap can count by. */
type HomeCandidateCredit = {
  name: string;
  joinPhrase: string;
  mbid?: string;
};

/** A Track as the composer places it, with what its card shows. */
export type HomeCandidate = ComposableTrack &
  Omit<HomeTrack, 'artistCredit'> & { artistCredit: HomeCandidateCredit[] };

/** A candidate row: where its Tracks come from and how the row is titled. */
export type HomeRowSource = {
  id: string;
  layout: HomeLayout;
  /** Standard rows show it; a hero has no title. */
  title?: HomeRowTitle;
  /** Bounded source query size used when replenishing candidate pages. */
  candidatePageSize?: number;
  loadPage?: (
    locale?: Locale,
    offset?: number,
  ) => Promise<{ items: HomeCandidate[]; hasMore: boolean }>;
  /**
   * Loads the candidates of one feed locale, best first. Without a locale, the
   * default one.
   */
  load: (locale?: Locale, offset?: number) => Promise<HomeCandidate[]>;
};

export const toHomeCandidate = (record: HomeTrackRecord): HomeCandidate => {
  const [primary] = record.artistCredit;
  const { vocalRangeLowest, vocalRangeHighest } = record;
  return {
    id: record.id,
    title: record.title,
    coverUrl: record.coverUrl,
    artistCredit: record.artistCredit,
    durationMs: record.lengthMs,
    vocalRange:
      vocalRangeLowest === null || vocalRangeHighest === null
        ? null
        : { lowest: vocalRangeLowest, highest: vocalRangeHighest },
    artistKey: primary?.mbid ?? primary?.name ?? record.id,
    artistKeys: homeArtistKeys(record.artistCredit, record.id),
    hasCover: record.coverUrl !== null,
    // The repository only reads Tracks whose Processing completed.
    isCompleted: true,
    // Absent means no stored Vocal range, from a Track without notes.
    hasVocalRange: vocalRangeLowest !== null && vocalRangeHighest !== null,
  };
};

const title = (key: string): HomeRowTitle => ({ key, params: {} });

/** Orders records by ranked IDs, skipping IDs without a completed Track. */
export const inRankOrder = (
  records: HomeTrackRecord[],
  ids: readonly string[],
): HomeTrackRecord[] => rankedHomeRecords(records, ids);

const mostSungCounts = async (
  repository: HomeRecords,
  locale: Locale,
  offset: number,
) => {
  const since = windowSince(SINGING_SIGNAL_WINDOW_DAYS);
  const evidence = await repository.localePracticeEvidence(locale, since);
  const useLocale =
    evidence !== undefined &&
    hasSufficientLocaleEvidence(evidence.distinctUsers, evidence.activeDays);
  return offset === 0
    ? repository.findMostSungTrackIds(
        CANDIDATE_LIMIT,
        since,
        useLocale ? locale : undefined,
      )
    : repository.findMostSungTrackIds(
        CANDIDATE_LIMIT,
        since,
        useLocale ? locale : undefined,
        offset,
      );
};

const mostFavoritedCounts = (repository: HomeRecords, offset: number) => {
  const since = windowSince(SINGING_SIGNAL_WINDOW_DAYS);
  return offset === 0
    ? repository.findMostFavoritedTrackIds(CANDIDATE_LIMIT, since)
    : repository.findMostFavoritedTrackIds(CANDIDATE_LIMIT, since, offset);
};

const candidatePage = (
  records: HomeTrackRecord[],
  hasMore: boolean,
): HomeRowCandidatePage => ({
  items: records.map(toHomeCandidate),
  hasMore,
});

type HomeRowCandidatePage = {
  items: HomeCandidate[];
  hasMore: boolean;
};

const pagedRecommendationRow = (
  id: string,
  titleKey: string,
  loadPage: NonNullable<HomeRowSource['loadPage']>,
): HomeRowSource => ({
  id,
  layout: 'standard',
  title: title(titleKey),
  candidatePageSize: CANDIDATE_LIMIT,
  loadPage,
  load: async (locale, offset) => (await loadPage(locale, offset)).items,
});

const createTrendingSources = (
  repository: HomeRecords,
  ranking: TrendingRanking,
): HomeRowSource[] => {
  const loadPage = async (locale = DEFAULT_HOME_LOCALE, offset = 0) => {
    const page = await localeTrending(repository, ranking, locale, { offset });
    return candidatePage(page.items, page.hasMore);
  };
  const load = async (locale?: Locale, offset?: number) =>
    (await loadPage(locale, offset)).items;
  return [
    { id: 'hero', layout: 'hero', load },
    pagedRecommendationRow(
      'trending-today',
      'home.rows.trendingToday',
      loadPage,
    ),
  ];
};

const createMostSungRow = (repository: HomeRecords): HomeRowSource =>
  pagedRecommendationRow(
    'most-sung',
    'home.rows.mostSung',
    async (locale = DEFAULT_HOME_LOCALE, offset = 0) => {
      const counts = await mostSungCounts(repository, locale, offset);
      const ids = counts.map(({ trackId }) => trackId);
      const records = inRankOrder(
        await repository.findCompletedTracksByIds(ids),
        ids,
      );
      return candidatePage(records, counts.length === CANDIDATE_LIMIT);
    },
  );

const createMostFavoritedRow = (repository: HomeRecords): HomeRowSource =>
  pagedRecommendationRow(
    'most-favorited',
    'home.rows.mostFavorited',
    async (_locale, offset = 0) => {
      const counts = await mostFavoritedCounts(repository, offset);
      const ids = counts.map(({ trackId }) => trackId);
      const records = inRankOrder(
        await repository.findCompletedTracksByIds(ids),
        ids,
      );
      return candidatePage(records, counts.length === CANDIDATE_LIMIT);
    },
  );

const createTop10Row = (
  repository: HomeRecords,
  ranking: TrendingRanking,
): HomeRowSource => ({
  id: 'top-10-week',
  layout: 'ranked',
  title: title('home.rows.top10Week'),
  load: async (locale = DEFAULT_HOME_LOCALE) =>
    (await weeklyTop10(repository, ranking, locale)).map(toHomeCandidate),
});

const createNewestRow = (repository: HomeRecords): HomeRowSource =>
  pagedRecommendationRow(
    'new-tracks',
    'home.rows.newTracks',
    async (_locale, offset = 0) => {
      const records = await repository.findNewestTracks(
        CANDIDATE_LIMIT,
        offset,
      );
      return candidatePage(records, records.length === CANDIDATE_LIMIT);
    },
  );

/** Keeps the established public category order. */
export const createHomeRowSources = (
  repository: HomeRecords,
  ranking: TrendingRanking,
): HomeRowSource[] => [
  ...createTrendingSources(repository, ranking),
  createMostSungRow(repository),
  createMostFavoritedRow(repository),
  createTop10Row(repository, ranking),
  createNewestRow(repository),
];

/** A genre as the composer places it: its name is its stable id. */
export type HomeGenreCandidate = ComposableEntity & { name: string };

/** An Artist as the composer places it: its id links to its page. */
export type HomeArtistCandidate = ComposableEntity & { name: string };

/** An Album as the composer places it: its id links to its page. */
export type HomeAlbumCandidate = ComposableEntity & {
  title: string;
  coverArtUrl: string | null;
  year: number | null;
};

/** A candidate row of entities: genres, artists or albums, never Tracks. */
export type HomeEntityRowSource =
  | {
      id: string;
      layout: 'genres';
      title: HomeRowTitle;
      load: (locale?: Locale) => Promise<HomeGenreCandidate[]>;
    }
  | {
      id: string;
      layout: 'artists';
      title: HomeRowTitle;
      load: (locale?: Locale) => Promise<HomeArtistCandidate[]>;
    }
  | {
      id: string;
      layout: 'albums';
      title: HomeRowTitle;
      load: (locale?: Locale) => Promise<HomeAlbumCandidate[]>;
      loadSnapshot?: (locale?: Locale) => Promise<{
        items: HomeAlbumCandidate[];
        candidates: HomeAlbumCandidateSnapshot[];
      }>;
    };

/** Injection token of the entity row sources the builder composes. */
export const HOME_ENTITY_ROW_SOURCES = Symbol('HOME_ENTITY_ROW_SOURCES');

/** The repository reads the entity row sources need; narrowed for fakes. */
type HomeEntityRecords = Pick<
  HomeRepository,
  | 'findGenreTrackCounts'
  | 'findPopularArtists'
  | 'findPopularAlbums'
  | 'localePracticeEvidence'
> &
  Partial<Pick<HomeRepository, 'findAlbumTrackSignals'>>;

/**
 * The feed's entity rows, in order: genre tiles, featured artists, featured
 * albums. Genres count the catalog's completed Tracks, so every locale shares
 * the same tiles behind its translated title.
 */
export const createHomeEntityRowSources = (
  repository: HomeEntityRecords,
  ranking: TrendingRanking,
): HomeEntityRowSource[] => [
  {
    id: 'genres',
    layout: 'genres',
    title: title('home.rows.genres'),
    load: async () =>
      (await repository.findGenreTrackCounts(CANDIDATE_LIMIT))
        .filter((entry) => entry.trackCount >= MIN_TRACKS_PER_GENRE)
        .map((entry) => ({ id: entry.genre, name: entry.genre })),
  },
  {
    id: 'featured-artists',
    layout: 'artists',
    title: title('home.rows.featuredArtists'),
    load: async () =>
      (await repository.findPopularArtists(CANDIDATE_LIMIT)).map((record) => ({
        id: record.id,
        name: record.name,
      })),
  },
  {
    id: 'featured-albums',
    layout: 'albums',
    title: title('home.rows.featuredAlbums'),
    load: async (locale = DEFAULT_HOME_LOCALE) =>
      (await loadUsefulAlbumSnapshot(repository, ranking, locale)).items,
    loadSnapshot: (locale = DEFAULT_HOME_LOCALE) =>
      loadUsefulAlbumSnapshot(repository, ranking, locale),
  },
];
