import type { HomeRow } from '@vozzify/contracts';
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
  discovery: Awaited<ReturnType<PersonalHomeRepository['findDiscoveryTracks']>>;
  taste: ReturnType<typeof decayedTaste>;
  lambda: number;
  mastered: ReadonlySet<string>;
  userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
  usedTrackIds: Set<string>;
  reservedTrackIds: ReadonlySet<string>;
}): { voiceRows: HomeRow[]; discoveryRows: HomeRow[] } => {
  const {
    publicRows,
    discovery,
    taste,
    lambda,
    mastered,
    userRange,
    usedTrackIds,
    reservedTrackIds,
  } = options;
  const sorted = blendedDiscoveryPool({
    publicRows,
    discovery,
    taste,
    lambda,
    masteredTrackIds: mastered,
    userRange,
  });
  const voiceRows = userRange
    ? buildPersonalVoiceRows({
        rows: publicRows,
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
    sorted,
    masteredTrackIds: mastered,
    alreadyUsedTrackIds: usedTrackIds,
    reservedTrackIds,
  });
  return { voiceRows, discoveryRows };
};
