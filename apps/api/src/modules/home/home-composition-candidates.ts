import { homeRowTitleSchema, homeTrackSchema } from '@vozzify/contracts';
import { z } from 'zod';
import type { HomeCandidate } from './home-row-sources.js';
import {
  HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS,
  HOME_EXPANDED_ROW_ARTIST_CANDIDATE_LIMIT,
} from './home-rules.js';

const homeCompositionCandidateTrackSchema = homeTrackSchema.extend({
  artistKey: z.string(),
  artistKeys: z.array(z.string()).optional(),
  sourcePosition: z.number().int().nonnegative().optional(),
  hasCover: z.boolean(),
  isCompleted: z.boolean(),
  hasVocalRange: z.boolean().optional(),
  personalTasteScore: z.number().finite().optional(),
});

const homeCompositionCandidateRowSchema = z.object({
  id: z.string(),
  layout: z.enum(['hero', 'standard', 'vocal-range', 'ranked']),
  title: homeRowTitleSchema.optional(),
  nextOffset: z.number().int().nonnegative().optional(),
  hasMore: z.boolean().optional(),
  personalExplorationSeed: z.string().optional(),
  items: z
    .array(homeCompositionCandidateTrackSchema)
    .max(HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS),
});

export const homeCompositionCandidatesSchema = z.array(
  homeCompositionCandidateRowSchema,
);

export type HomeCompositionCandidateTrack = z.infer<
  typeof homeCompositionCandidateTrackSchema
>;
export type HomeCompositionCandidateRow = z.infer<
  typeof homeCompositionCandidateRowSchema
>;

export const retainUsefulCompositionCandidates = <
  T extends { id: string; artistKey: string; artistKeys?: string[] },
>(
  candidates: readonly T[],
  excludedIds: ReadonlySet<string> = new Set(),
  artistLimit = HOME_EXPANDED_ROW_ARTIST_CANDIDATE_LIMIT,
): T[] => {
  const artistCounts = new Map<string, number>();
  const retained: T[] = [];
  for (const candidate of candidates) {
    if (excludedIds.has(candidate.id)) continue;
    const keys = [...new Set(candidate.artistKeys ?? [candidate.artistKey])];
    if (keys.some((key) => (artistCounts.get(key) ?? 0) >= artistLimit)) {
      continue;
    }
    retained.push(candidate);
    for (const key of keys) {
      artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1);
    }
    if (retained.length >= HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS) break;
  }
  return retained;
};
export const toHomeCompositionCandidateTrack = (
  candidate: HomeCandidate,
): HomeCompositionCandidateTrack => ({
  id: candidate.id,
  title: candidate.title,
  coverUrl: candidate.coverUrl,
  artistCredit: candidate.artistCredit.map(({ name, joinPhrase }) => ({
    name,
    joinPhrase,
  })),
  durationMs: candidate.durationMs,
  vocalRange: candidate.vocalRange,
  artistKey: candidate.artistKey,
  ...(candidate.artistKeys ? { artistKeys: candidate.artistKeys } : {}),
  hasCover: candidate.hasCover,
  isCompleted: candidate.isCompleted,
  ...(candidate.hasVocalRange === undefined
    ? {}
    : { hasVocalRange: candidate.hasVocalRange }),
});
