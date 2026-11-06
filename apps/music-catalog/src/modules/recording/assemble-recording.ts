import type { Recording } from '@vozzify/contracts';
import { coverArtUrl } from '../../lib/cover-art-url.js';
import { chooseTags } from './genre-fallback.js';
import {
  earliestCoverDate,
  orderCoverReleases,
  type RankedRelease,
} from './recording-cover-order.js';
import type {
  RecordingDetails,
  RecordingRow,
  ReleaseEventRow,
  ReleaseRow,
} from './recording-data.js';
import { pickReleaseEvent } from './release-event.js';

const toRelease = (
  row: ReleaseRow,
  events: readonly ReleaseEventRow[],
): RankedRelease => {
  const ownEvents = events.filter((event) => event.releaseId === row.id);
  const { date, country } = pickReleaseEvent(ownEvents);
  return {
    coverRank: row.coverRank,
    coverDate: earliestCoverDate(ownEvents),
    release: {
      mbid: row.mbid,
      title: row.title,
      releaseGroup: {
        mbid: row.releaseGroupMbid,
        primaryType: row.primaryType,
      },
      status: row.status,
      date,
      country,
      mediumPosition: row.mediumPosition,
      trackPosition: row.trackPosition,
      coverArtUrl: coverArtUrl(row.mbid),
    },
  };
};

/**
 * Builds the protocol's `Recording` from the rows read for it. No I/O: the
 * rules that shape the answer are here (which release event a release is
 * shown with, the release order, where the genres come from), so they can be
 * tested on their own.
 */
export const assembleRecording = (
  row: RecordingRow,
  details: RecordingDetails,
): Recording => {
  const { source, genres, tags } = chooseTags(details.tagLevels);
  return {
    mbid: row.mbid,
    title: row.title,
    lengthMs: row.lengthMs,
    disambiguation: row.disambiguation,
    video: row.video,
    isrcs: details.isrcs,
    artistCredit: { name: row.artistCreditName, artists: details.artists },
    releases: orderCoverReleases(
      details.releases.map((release) =>
        toRelease(release, details.releaseEvents),
      ),
    ),
    works: details.works,
    genres,
    tags,
    tagsSource: source,
    externalUrls: details.externalUrls,
  };
};
