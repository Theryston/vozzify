import type { TrackKeyMode } from '@vozzify/contracts';
import { estimateKey } from '../../integrations/note-detection/track-key.js';
import type { NoteSpan } from './track-note-span.js';
import { vocalRangeOf } from './track-vocal-range.js';

export type NoteSummary = {
  vocalRangeLowest: number | null;
  vocalRangeHighest: number | null;
  keyTonic: number | null;
  keyMode: TrackKeyMode | null;
};

/**
 * The columns a Track keeps of its notes, the vocal range and the estimated
 * key, all null for a Track without notes. A Processing writes them when it
 * replaces the notes, and the backfill writes them for the Tracks completed
 * before they existed.
 */
export function noteSummaryOf(notes: readonly NoteSpan[]): NoteSummary {
  const range = vocalRangeOf(notes);
  const key = estimateKey(notes);
  return {
    vocalRangeLowest: range?.lowest ?? null,
    vocalRangeHighest: range?.highest ?? null,
    keyTonic: key?.tonic ?? null,
    keyMode: key?.mode ?? null,
  };
}
