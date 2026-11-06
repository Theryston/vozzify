import { accuracyBand } from '@vozzify/contracts';
import { personalConfidenceLambda } from './home-stage2-scoring.js';

/**
 * The personal blend of the home feed. The public popularity is the base and
 * a personal component is blended in: `final = (1 - λ) · popularity + λ ·
 * personal`. λ grows with the User's amount of data: no data means the public
 * feed. The personal component starts with taste from the genres and artists
 * of the User's Attempts and favorites. Pure: the builder loads the signals
 * and maps the rows it gets back.
 */

/** What a Track's genres weigh in its personal score. */
export const PERSONAL_GENRE_WEIGHT = 1;

/** What a Track's artist weighs in its personal score. */
export const PERSONAL_ARTIST_WEIGHT = 2;

/** Recent practice matters more; taste signals lose half their weight each month. */
export const TASTE_SIGNAL_HALF_LIFE_DAYS = 30;

/** The share of discovery placements reserved for Tracks outside the User's taste. */
export const EXPLORATION_SLOT_SHARE = 0.2;

/** How many preferred genres can supply one personal genre row. */
export const PERSONAL_GENRE_LIMIT = 3;

/** The voice-fit signal has one share of the personal score when available. */
const PERSONAL_VOICE_FIT_WEIGHT = 1;

/** Confidence from distinct supported Tracks and active Practice days. */
export const personalLambda = (
  distinctTracks: number,
  activeDays: number,
): number => personalConfidenceLambda(distinctTracks, activeDays);

/**
 * A Track's share of the User's taste for its genres: the average, over its
 * genres, of each genre's share of all genre signals. Unknown genres and an
 * empty taste read as 0, so a Track without a match never outranks one with.
 */
export const genreAffinity = (
  genres: readonly string[],
  genreSignals: ReadonlyMap<string, number>,
  totalGenreSignals: number,
): number => {
  if (genres.length === 0 || totalGenreSignals <= 0) {
    return 0;
  }
  const share = genres.reduce(
    (sum, genre) => sum + (genreSignals.get(genre) ?? 0),
    0,
  );
  return share / genres.length / totalGenreSignals;
};

/**
 * A Track's share of the User's taste for its artist: the artist's share of
 * all artist signals. An unknown artist and an empty taste read as 0.
 */
export const artistAffinity = (
  artistKey: string,
  artistSignals: ReadonlyMap<string, number>,
  totalArtistSignals: number,
): number =>
  totalArtistSignals <= 0
    ? 0
    : (artistSignals.get(artistKey) ?? 0) / totalArtistSignals;

/**
 * A Track's personal score from its taste affinities, between 0 and 1 like
 * the normalized popularity it blends with.
 */
export const personalScore = (
  genres: readonly string[],
  artistKey: string,
  taste: PersonalTaste,
): number =>
  (PERSONAL_GENRE_WEIGHT *
    genreAffinity(genres, taste.genreSignals, taste.totalGenreSignals) +
    PERSONAL_ARTIST_WEIGHT *
      artistAffinity(
        artistKey,
        taste.artistSignals,
        taste.totalArtistSignals,
      )) /
  (PERSONAL_GENRE_WEIGHT + PERSONAL_ARTIST_WEIGHT);

/** Adds voice fit only when both the User and Track have a derived range. */
export const personalScoreWithVoice = (
  tasteScore: number,
  voiceFit: number | null,
): number =>
  voiceFit === null
    ? tasteScore
    : (tasteScore + PERSONAL_VOICE_FIT_WEIGHT * voiceFit) /
      (PERSONAL_VOICE_FIT_WEIGHT + 1);

/** The User's taste: signal counts per genre and artist, with their totals. */
export type PersonalTaste = {
  genreSignals: ReadonlyMap<string, number>;
  totalGenreSignals: number;
  artistSignals: ReadonlyMap<string, number>;
  totalArtistSignals: number;
};

/** The blend of one Track's popularity with its personal score. */
export const blendScore = (
  popularity: number,
  personal: number,
  lambda: number,
): number => (1 - lambda) * popularity + lambda * personal;

/**
 * Whether the User mastered the Track: their best accuracy reached the hit
 * band, the same 85% the Profile's accuracy bands use. Mastered Tracks have
 * their own "sing again" row, so they stay out of the discovery rows.
 */
export const isMasteredTrack = (bestAccuracy: number): boolean =>
  accuracyBand(bestAccuracy) === 'hit';

/**
 * Whether a snapshot built at `generatedAt` is older than the staleness
 * limit: still served, but its rebuild is queued.
 */
export const personalSnapshotStale = (
  generatedAt: string,
  staleAfterSeconds: number,
  now = Date.now(),
): boolean => now - Date.parse(generatedAt) > staleAfterSeconds * 1000;
