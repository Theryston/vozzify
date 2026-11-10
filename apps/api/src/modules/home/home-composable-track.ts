/** Track fields the Home composer needs to place an item in a Row. */
export type ComposableTrack = {
  id: string;
  /** The artist the per-row cap counts by (the credit's first artist). */
  artistKey: string;
  /** Every credited Artist participates in the same per-row limit. */
  artistKeys?: string[];
  hasCover: boolean;
  /** Only Tracks whose Processing completed may appear in the feed. */
  isCompleted: boolean;
  /** Absent means no stored Vocal range: only the by-voice rows ask for one. */
  hasVocalRange?: boolean;
  /** Global collective score, present only in the strong genre pool. */
  collectiveScore?: number;
  /** Existing confidence-aware blend; collective admission remains separate. */
  personalBlendedScore?: number;
};
