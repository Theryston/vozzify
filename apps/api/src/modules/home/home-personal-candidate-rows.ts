import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import type { AttemptsService } from '../attempts/attempts.service.js';
import type { PersonalHomeRepository } from './home-personal.repository.js';
import {
  blendedDiscoveryPool,
  buildPersonalDiscoveryRows,
} from './home-personal-discovery.js';
import { decayedTaste } from './home-personal-recommendations.js';
import {
  buildPersonalVoiceRows,
  personalVoiceRowTrackIds,
} from './home-personal-voice.js';

export const buildPersonalVoiceAndDiscoveryRows = (options: {
  publicRows: HomeRow[];
  candidateTracks?: HomeTrack[];
  candidatesByRow?: Record<string, HomeTrack[]>;
  discovery: Awaited<ReturnType<PersonalHomeRepository['findDiscoveryTracks']>>;
  taste: ReturnType<typeof decayedTaste>;
  lambda: number;
  mastered: ReadonlySet<string>;
  userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
  voiceConfidence?: number;
  usedTrackIds: Set<string>;
  reservedTrackIds: ReadonlySet<string>;
}): {
  voiceRows: HomeRow[];
  discoveryRows: HomeRow[];
  sourcePoolsByRow: Record<string, HomeTrack[]>;
} => {
  const {
    publicRows,
    candidateTracks,
    candidatesByRow,
    discovery,
    taste,
    lambda,
    mastered,
    userRange,
    voiceConfidence,
    usedTrackIds,
    reservedTrackIds,
  } = options;
  const sorted = blendedDiscoveryPool({
    publicRows,
    catalogTracks: candidateTracks,
    discovery,
    taste,
    lambda,
    masteredTrackIds: mastered,
    userRange,
    voiceConfidence,
  });
  const voiceRows = userRange
    ? buildPersonalVoiceRows({
        rows: publicRows,
        candidateTracks,
        userRange,
        discovery,
        masteredTrackIds: mastered,
        alreadyUsedTrackIds: usedTrackIds,
      })
    : [];
  for (const id of personalVoiceRowTrackIds(voiceRows)) {
    usedTrackIds.add(id);
  }
  const discoveryRows = buildPersonalDiscoveryRows({
    publicRows,
    candidatesByRow,
    catalogCandidates: sorted,
    sorted,
    masteredTrackIds: mastered,
    alreadyUsedTrackIds: usedTrackIds,
    reservedTrackIds,
  });
  const sourcePoolsByRow: Record<string, HomeTrack[]> = {};
  for (const [rowId, tracks] of Object.entries(candidatesByRow ?? {})) {
    if (tracks) sourcePoolsByRow[rowId] = tracks;
  }
  sourcePoolsByRow['recommended-for-you'] = sorted.map(
    (candidate) => candidate.track,
  );
  return { voiceRows, discoveryRows, sourcePoolsByRow };
};
