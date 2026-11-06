import type { RecordingTagsSource } from '@vozzify/contracts';
import type { CreditedArtistRow } from '../../database/credited-artists.js';
import type { PartialDate } from '../../lib/partial-date.js';
import type { TagVotes } from '../../lib/tag-votes.js';

// What the repository reads for one Recording, before it is assembled into
// the protocol's `Recording`. Plain rows: no rule is applied to them yet.

/** The Recording's own row, with its artist credit's printed name. */
export type RecordingRow = {
  /** MusicBrainz's integer id: internal, it disappears on a merge. */
  id: number;
  mbid: string;
  title: string;
  lengthMs: number | null;
  disambiguation: string;
  video: boolean;
  artistCreditId: number;
  artistCreditName: string;
};

/** A release the Recording is on, at one of its tracks. */
export type ReleaseRow = {
  id: number;
  coverRank: number;
  mbid: string;
  title: string;
  releaseGroupMbid: string;
  primaryType: string | null;
  status: string | null;
  mediumPosition: number;
  trackPosition: number;
};

/** One release event: its date (any part may be unknown) and its country. */
export type ReleaseEventRow = PartialDate & {
  releaseId: number;
  /** ISO 3166-1 alpha-2 code, null for an unknown country. */
  country: string | null;
};

export type WorkRow = { mbid: string; title: string };

export type ExternalUrlRow = { url: string; linkType: string };

/** A tag with its vote count, as the Recording's repository reads it. */
export type TagVotesRow = TagVotes;

/** The tags at each level a Recording's genres may come from. */
export type TagLevels = Record<RecordingTagsSource, TagVotesRow[]>;

/** Everything read about a Recording besides its own row. */
export type RecordingDetails = {
  artists: CreditedArtistRow[];
  isrcs: string[];
  releases: ReleaseRow[];
  releaseEvents: ReleaseEventRow[];
  works: WorkRow[];
  externalUrls: ExternalUrlRow[];
  tagLevels: TagLevels;
};
