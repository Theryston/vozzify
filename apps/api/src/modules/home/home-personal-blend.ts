import type { HomeTrack, TrackVocalRange } from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import {
  blendScore,
  type PersonalTaste,
  personalScore,
} from './home-personal.js';
import type { UserTrackSignal } from './home-personal.repository.js';
import { personalScoreWithConfidenceAwareVoice } from './home-stage2-scoring.js';
import { voiceFitScore } from './home-voice-fit.js';

/** A Track of the public feed with its blend inputs. */
export type DiscoveryCandidate = {
  track: HomeTrack;
  artistKey: string;
  artistKeys?: string[];
  hasCover: boolean;
  popularity: number;
  personal: number;
  blended: number;
};

export const byBlendedDesc = (
  a: DiscoveryCandidate,
  b: DiscoveryCandidate,
): number => b.blended - a.blended;

const artistKeyOf = (track: HomeTrack): string =>
  track.artistCredit[0]?.name ?? track.id;

/** What the discovery blend needs of a Track: its score and its taste. */
export type DiscoveryTrack = {
  trendingScore: number;
  genres: string[];
  artistKey: string;
  artistKeys?: string[];
};

/**
 * The taste counts of the builder, from Attempts (one signal per run) and
 * favorites (one each), with the total number of signals the blend weight
 * grows with.
 */
export const buildTaste = (
  signals: UserTrackSignal[],
  favorites: { genres: string[]; artistKey: string }[],
): { taste: PersonalTaste; signalCount: number } => {
  const genreSignals = new Map<string, number>();
  const artistSignals = new Map<string, number>();
  const add = (genres: string[], artistKey: string, weight: number) => {
    for (const genre of genres) {
      genreSignals.set(genre, (genreSignals.get(genre) ?? 0) + weight);
    }
    artistSignals.set(artistKey, (artistSignals.get(artistKey) ?? 0) + weight);
  };
  let signalCount = 0;
  for (const signal of signals) {
    add(signal.genres, signal.artistKey, signal.attempts);
    signalCount += signal.attempts;
  }
  for (const favorite of favorites) {
    add(favorite.genres, favorite.artistKey, 1);
    signalCount += 1;
  }
  const totalOf = (counts: ReadonlyMap<string, number>): number =>
    [...counts.values()].reduce((sum, count) => sum + count, 0);
  return {
    taste: {
      genreSignals,
      totalGenreSignals: totalOf(genreSignals),
      artistSignals,
      totalArtistSignals: totalOf(artistSignals),
    },
    signalCount,
  };
};

/**
 * Every public Track with its popularity (its trending score over the best
 * one, so the best reads 1) blended with its personal score from the User's
 * taste. A feed without scores reads every popularity as 1, so the taste
 * alone orders it; at λ = 0 the public order is kept.
 */
export const blendDiscoveryCandidates = (options: {
  tracks: HomeTrack[];
  catalogTracks?: HomeTrack[];
  discovery: ReadonlyMap<string, DiscoveryTrack>;
  taste: PersonalTaste;
  lambda: number;
  userRange?: TrackVocalRange | null;
  voiceConfidence?: number;
}): DiscoveryCandidate[] => {
  const { tracks, discovery, taste, lambda, userRange } = options;
  const uniqueTracks = new Map(
    [...tracks, ...(options.catalogTracks ?? [])].map((track) => [
      track.id,
      track,
    ]),
  );
  const maxScore = Math.max(
    0,
    ...[...discovery.values()].map((track) => track.trendingScore),
  );
  return [...uniqueTracks.values()].map((track) => {
    const found = discovery.get(track.id);
    const popularity =
      maxScore > 0 ? (found?.trendingScore ?? 0) / maxScore : 1;
    const tasteScore = personalScore(
      found?.genres ?? [],
      found?.artistKey ?? artistKeyOf(track),
      taste,
    );
    const voiceFit =
      userRange && track.vocalRange
        ? voiceFitScore(userRange, track.vocalRange)
        : null;
    const personal = personalScoreWithConfidenceAwareVoice(
      tasteScore,
      voiceFit,
      options.voiceConfidence ?? 0,
    );
    return {
      track,
      artistKey: found?.artistKey ?? artistKeyOf(track),
      artistKeys:
        found?.artistKeys ?? homeArtistKeys(track.artistCredit, track.id),
      hasCover: track.coverUrl !== null,
      popularity,
      personal,
      blended: blendScore(popularity, personal, lambda),
    };
  });
};
