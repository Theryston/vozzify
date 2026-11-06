const recordingsOnReleaseGroups = `SELECT r.id AS recording_id,
      r.gid AS recording_mbid
    FROM musicbrainz.recording r
    JOIN musicbrainz.track t ON t.recording = r.id
    JOIN musicbrainz.medium m ON m.id = t.medium
    JOIN musicbrainz.release rel ON rel.id = m.release
    JOIN musicbrainz.release_group rg ON rg.id = rel.release_group`;

/** Release metadata can change cover identity without changing any Track. */
export const COVER_SYNC_TABLES = [
  {
    table: 'release_group',
    selectNew: `${recordingsOnReleaseGroups} WHERE rg.id = NEW.id`,
  },
  {
    table: 'release_group_secondary_type_join',
    selectNew: `${recordingsOnReleaseGroups}
      WHERE rg.id = NEW.release_group`,
  },
  {
    table: 'release_group_secondary_type',
    selectNew: `${recordingsOnReleaseGroups}
      JOIN musicbrainz.release_group_secondary_type_join st
        ON st.release_group = rg.id
      WHERE st.secondary_type = NEW.id`,
  },
  {
    table: 'release_status',
    selectNew: `${recordingsOnReleaseGroups} WHERE rel.status = NEW.id`,
  },
] as const;

export const releaseCreditRecordings = `${recordingsOnReleaseGroups}
    WHERE rg.artist_credit = NEW.artist_credit`;
