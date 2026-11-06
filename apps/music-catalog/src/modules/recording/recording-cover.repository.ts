import { type SQLWrapper, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { artistCreditName } from '../../database/schema/musicbrainz/artist.js';
import {
  releaseGroup,
  releaseGroupSecondaryType,
  releaseGroupSecondaryTypeJoin,
  releaseStatus,
} from '../../database/schema/musicbrainz/release.js';

const releaseArtist = alias(artistCreditName, 'cover_release_artist');
const recordingArtist = alias(artistCreditName, 'cover_recording_artist');

/**
 * Both Recording reads and indexed search must choose the same cover source.
 * Keep compilations as fallbacks; shared artist identity handles guest credits
 * without relying on identical printed credits or names.
 */
export const coverRankSql = (recordingCredit: SQLWrapper) => sql<number>`(
  case when exists (
    select 1 from ${releaseGroupSecondaryTypeJoin}
    join ${releaseGroupSecondaryType} on ${releaseGroupSecondaryType.id} =
      ${releaseGroupSecondaryTypeJoin.secondaryType}
    where ${releaseGroupSecondaryTypeJoin.releaseGroup} = ${releaseGroup.id}
      and ${releaseGroupSecondaryType.name} = 'Compilation'
  ) then 4 else 0 end
  + case when exists (
    select 1 from ${artistCreditName} as cover_release_artist
    join ${artistCreditName} as cover_recording_artist
      on ${recordingArtist.artist} = ${releaseArtist.artist}
    where ${releaseArtist.artistCredit} = ${releaseGroup.artistCredit}
      and ${recordingArtist.artistCredit} = ${recordingCredit}
  ) then 0 else 2 end
  + case when ${releaseStatus.name} = 'Official' then 0 else 1 end
)`;
