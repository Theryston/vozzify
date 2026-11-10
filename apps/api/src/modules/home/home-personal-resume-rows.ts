import type { HomeCarouselRow, HomeRow, HomeTrack } from '@vozzify/contracts';
import { composeHomeRows } from './home-feed-composer.js';
import type { UserTrackSignal } from './home-personal.repository.js';
import {
  HOME_TRACK_ROW_MAX_ITEMS,
  PERSONAL_RESUME_ROW_MIN_ITEMS,
} from './home-rules.js';

const title = (key: string) => ({ key, params: {} });

export const trackIdsOfRow = (row: HomeRow): string[] => {
  if (row.layout === 'hero') return [row.track.id];
  if (
    row.layout === 'standard' ||
    row.layout === 'vocal-range' ||
    row.layout === 'ranked'
  ) {
    return row.items.map((track) => track.id);
  }
  return [];
};

const toResumeCandidate = (signal: UserTrackSignal) => ({
  id: signal.trackId,
  artistKey: signal.artistKey,
  hasCover: signal.coverUrl !== null,
  isCompleted: true,
  track: {
    id: signal.trackId,
    title: signal.title,
    coverUrl: signal.coverUrl,
    artistCredit: signal.artistCredit,
    durationMs: signal.durationMs,
    vocalRange:
      signal.vocalRangeLowest === null || signal.vocalRangeHighest === null
        ? null
        : {
            lowest: signal.vocalRangeLowest,
            highest: signal.vocalRangeHighest,
          },
  } satisfies HomeTrack,
});

const resumeDescriptors = (
  signals: UserTrackSignal[],
  mastered: ReadonlySet<string>,
) => {
  const candidates = signals.map(toResumeCandidate);
  const bestOf = new Map(
    signals.map((signal) => [signal.trackId, signal.bestAccuracy]),
  );
  return [
    {
      id: 'continue-singing',
      title: title('home.rows.continueSinging'),
      items: candidates.filter((candidate) => !mastered.has(candidate.id)),
    },
    {
      id: 'sing-again',
      title: title('home.rows.singAgain'),
      items: candidates
        .filter((candidate) => mastered.has(candidate.id))
        .sort((a, b) => (bestOf.get(b.id) ?? 0) - (bestOf.get(a.id) ?? 0)),
    },
  ];
};

/** Canonical history is independent of the48-item final Row ceiling. */
export const resumeTrackPools = (
  signals: UserTrackSignal[],
  mastered: ReadonlySet<string>,
): Record<string, HomeTrack[]> =>
  Object.fromEntries(
    resumeDescriptors(signals, mastered).map((row) => [
      row.id,
      row.items.map(({ track }) => track),
    ]),
  );

/** Keep unfinished and mastered practice available before recommendations. */
export const resumeRows = (
  signals: UserTrackSignal[],
  mastered: ReadonlySet<string>,
  expanded = false,
): HomeRow[] => {
  const rows: HomeRow[] = [];
  for (const descriptor of resumeDescriptors(signals, mastered)) {
    const [composed] = composeHomeRows(
      [{ ...descriptor, layout: 'standard' as const }],
      { minimumItems: { standard: PERSONAL_RESUME_ROW_MIN_ITEMS } },
    );
    if (!composed) continue;
    rows.push({
      id: composed.id,
      layout: 'standard',
      title: composed.title ?? descriptor.title,
      items: (expanded
        ? descriptor.items.slice(0, HOME_TRACK_ROW_MAX_ITEMS)
        : composed.items
      ).map((item) => item.track),
    } satisfies HomeCarouselRow);
  }
  return rows;
};
