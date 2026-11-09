import { homeRowTitleSchema, homeTrackSchema } from '@vozzify/contracts';
import { z } from 'zod';
import type { HomeCandidate } from './home-row-sources.js';
import { HOME_COMPOSITION_CANDIDATE_POOL_MAX_ITEMS } from './home-rules.js';

const homeCompositionCandidateTrackSchema = homeTrackSchema.extend({
  artistKey: z.string(),
  artistKeys: z.array(z.string()).optional(),
  hasCover: z.boolean(),
  isCompleted: z.boolean(),
  hasVocalRange: z.boolean().optional(),
});

const homeCompositionCandidateRowSchema = z.object({
  id: z.string(),
  layout: z.enum(['hero', 'standard', 'vocal-range', 'ranked']),
  title: homeRowTitleSchema.optional(),
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
