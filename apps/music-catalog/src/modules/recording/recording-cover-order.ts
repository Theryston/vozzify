import type { RecordingRelease } from '@vozzify/contracts';
import { compareText, compareTextNullsLast } from '../../lib/compare.js';
import { formatPartialDate, type PartialDate } from '../../lib/partial-date.js';

export type RankedRelease = {
  release: RecordingRelease;
  coverRank: number;
  coverDate: string | null;
};

// An imprecise date must not claim to precede a known date in its own period.
const coverDate = (date: string | null): string | null =>
  date === null ? null : date.padEnd(10, '9');

/** A known early event must survive an imprecise event on the same release. */
export const earliestCoverDate = (
  events: readonly PartialDate[],
): string | null =>
  events
    .map((event) => coverDate(formatPartialDate(event)))
    .sort(compareTextNullsLast)[0] ?? null;

const compareReleases = (a: RankedRelease, b: RankedRelease): number =>
  a.coverRank - b.coverRank ||
  compareTextNullsLast(a.coverDate, b.coverDate) ||
  compareText(a.release.title, b.release.title) ||
  compareText(a.release.mbid, b.release.mbid) ||
  a.release.mediumPosition - b.release.mediumPosition ||
  a.release.trackPosition - b.release.trackPosition;

/** Internal cover preferences never become fields of the catalog protocol. */
export const orderCoverReleases = (
  releases: RankedRelease[],
): RecordingRelease[] =>
  releases.sort(compareReleases).map(({ release }) => release);
