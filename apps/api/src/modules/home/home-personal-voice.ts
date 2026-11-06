import type {
  HomeRow,
  HomeTrack,
  HomeVocalRangeRow,
  TrackVocalRange,
} from '@vozzify/contracts';
import { homeArtistKeys } from './home-artist-keys.js';
import { composeHomeRows } from './home-feed-composer.js';
import type { DiscoveryTrack } from './home-personal-blend.js';
import { challengeOverrun, voiceFitScore } from './home-voice-fit.js';

const ROW_TITLES = {
  within: { key: 'home.rows.withinYourVoice', params: {} },
  challenge: { key: 'home.rows.challengeYourRange', params: {} },
} as const;

type VoiceCandidate = {
  id: string;
  track: HomeTrack & { vocalRange: TrackVocalRange };
  artistKey: string;
  artistKeys: string[];
  hasCover: boolean;
  isCompleted: true;
  hasVocalRange: true;
  fitScore: number;
  overrun: number | null;
  trendingScore: number;
};

export const personalTrackPool = (rows: readonly HomeRow[]): HomeTrack[] =>
  rows.flatMap((row) => {
    if (row.layout === 'hero') {
      return [row.track];
    }
    if (
      row.layout === 'standard' ||
      row.layout === 'vocal-range' ||
      row.layout === 'ranked'
    ) {
      return row.items;
    }
    return [];
  });

const candidateOf = (
  track: HomeTrack,
  userRange: TrackVocalRange,
  discovery: ReadonlyMap<string, DiscoveryTrack>,
): VoiceCandidate | null => {
  if (!track.vocalRange) {
    return null;
  }
  const details = discovery.get(track.id);
  return {
    id: track.id,
    track: { ...track, vocalRange: track.vocalRange },
    artistKey: details?.artistKey ?? track.artistCredit[0]?.name ?? track.id,
    artistKeys:
      details?.artistKeys ?? homeArtistKeys(track.artistCredit, track.id),
    hasCover: track.coverUrl !== null,
    isCompleted: true,
    hasVocalRange: true,
    fitScore: voiceFitScore(userRange, track.vocalRange),
    overrun: challengeOverrun(userRange, track.vocalRange),
    trendingScore: details?.trendingScore ?? 0,
  };
};

const compareTrending = (a: VoiceCandidate, b: VoiceCandidate): number =>
  b.trendingScore - a.trendingScore;

/**
 * Builds the two personal range rows from public Tracks. Both rows share the
 * same composer, so their dedupe, per-artist cap and six-item minimum apply.
 */
export const buildPersonalVoiceRows = (options: {
  rows: readonly HomeRow[];
  candidateTracks?: HomeTrack[];
  userRange: TrackVocalRange;
  discovery: ReadonlyMap<string, DiscoveryTrack>;
  masteredTrackIds: ReadonlySet<string>;
  alreadyUsedTrackIds: ReadonlySet<string>;
}): HomeVocalRangeRow[] => {
  const {
    rows,
    candidateTracks = [],
    userRange,
    discovery,
    masteredTrackIds,
    alreadyUsedTrackIds,
  } = options;
  const uniqueTracks = new Map(
    [...personalTrackPool(rows), ...candidateTracks].map((track) => [
      track.id,
      track,
    ]),
  );
  const candidates = [...uniqueTracks.values()]
    .filter(
      (track) =>
        !masteredTrackIds.has(track.id) && !alreadyUsedTrackIds.has(track.id),
    )
    .flatMap((track) => {
      const candidate = candidateOf(track, userRange, discovery);
      return candidate ? [candidate] : [];
    });
  const within = candidates
    .filter((candidate) => candidate.fitScore > 0)
    .sort((a, b) => b.fitScore - a.fitScore || compareTrending(a, b));
  const challenge = candidates
    .filter(
      (candidate) => candidate.overrun !== null && candidate.fitScore === 0,
    )
    .sort(
      (a, b) => (a.overrun ?? 0) - (b.overrun ?? 0) || compareTrending(a, b),
    );
  const composed = composeHomeRows([
    {
      id: 'within-your-voice',
      layout: 'vocal-range' as const,
      title: ROW_TITLES.within,
      items: within,
    },
    {
      id: 'challenge-your-range',
      layout: 'vocal-range' as const,
      title: ROW_TITLES.challenge,
      items: challenge,
    },
  ]);
  return composed.map((row) => ({
    id: row.id,
    layout: 'vocal-range',
    title: row.title,
    items: row.items.map(({ track, fitScore }) => ({
      ...track,
      ...(fitScore > 0 ? { fitsVoice: fitScore === 1 } : {}),
    })),
  }));
};

/** The Track IDs already kept by the voice rows. */
export const personalVoiceRowTrackIds = (
  rows: readonly HomeVocalRangeRow[],
): Set<string> =>
  new Set(rows.flatMap((row) => row.items.map((item) => item.id)));
