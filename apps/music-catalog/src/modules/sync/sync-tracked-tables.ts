import {
  COVER_SYNC_TABLES,
  releaseCreditRecordings,
} from './cover-sync-tables.js';

/**
 * Which MusicBrainz tables feed a Recording's search document, and how the
 * affected Recordings are found from a changed row. The worker installs one
 * trigger per entry (see `buildSyncTriggersSql`), which writes the Recording
 * ids to the outbox; the drain then rebuilds their documents.
 *
 * To track another table, add one entry: the `selectNew` query sees the
 * changed row as `NEW` (the builder derives the `OLD` side for deletes and
 * for updates that move a row's linkage) and must return the columns
 * `recording_id` and `recording_mbid` of every Recording the change affects.
 * Tables whose columns only `getRecording` shows live (isrcs, cover art,
 * release group names, link type names) have no entry: nothing they change is
 * in the indexed search document.
 */

type TrackedTable = {
  /** The MusicBrainz table the trigger watches. */
  table: string;
  /**
   * Recordings the changed row (`NEW`) affects, as `recording_id` and
   * `recording_mbid`. Plain SQL in the trigger's scope, so it can join any
   * MusicBrainz table; it must not read the outbox. One entry per table is
   * all adding a table takes (see `TRACKED_TABLES` below).
   */
  selectNew: string;
};

/** Prefix of every trigger this ticket owns, so stale ones can be found. */
export const SYNC_TRIGGER_PREFIX = 'vozzify_sync';

export const triggerName = (table: string): string =>
  `${SYNC_TRIGGER_PREFIX}_${table}`;

/** Prefix of every trigger function this ticket owns, so stale ones can be found. */
export const SYNC_FUNCTION_PREFIX = 'sync_outbox_from';

/** The trigger function a tracked table's trigger calls. */
export const syncFunctionName = (table: string): string =>
  `${SYNC_FUNCTION_PREFIX}_${table}`;

const selectOld = (entry: TrackedTable): string =>
  entry.selectNew.replaceAll('NEW.', 'OLD.');

// The changed row carries the Recording's id in one of its own columns.
const byRecordingColumn = (table: string, column: string): TrackedTable => ({
  table,
  selectNew: `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r WHERE r.id = NEW.${column}`,
});

// The changed row names an artist: every Recording crediting it, through its
// artist credits.
const byArtistColumn = (table: string, column: string): TrackedTable => ({
  table,
  selectNew: `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r
    JOIN musicbrainz.artist_credit_name acn ON acn.artist_credit = r.artist_credit
    WHERE acn.artist = NEW.${column}`,
});

// The changed row names a release (directly or through its medium): every
// Recording on a track of it.
const byRelease = (table: string, condition: string): TrackedTable => ({
  table,
  selectNew: `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r
    JOIN musicbrainz.track t ON t.recording = r.id
    JOIN musicbrainz.medium m ON m.id = t.medium
    WHERE ${condition}`,
});

const RECORDING_TAG_LEVELS = `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r
    JOIN musicbrainz.recording_tag rt ON rt.recording = r.id
    JOIN musicbrainz.tag tg ON tg.id = rt.tag
    WHERE tg.id = NEW.id
  UNION
  SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r
    JOIN musicbrainz.track t ON t.recording = r.id
    JOIN musicbrainz.medium m ON m.id = t.medium
    JOIN musicbrainz.release rel ON rel.id = m.release
    JOIN musicbrainz.release_group_tag rgt ON rgt.release_group = rel.release_group
    JOIN musicbrainz.tag tg ON tg.id = rgt.tag
    WHERE tg.id = NEW.id
  UNION
  SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r
    JOIN musicbrainz.artist_credit_name acn ON acn.artist_credit = r.artist_credit
    JOIN musicbrainz.artist_tag atag ON atag.artist = acn.artist
    JOIN musicbrainz.tag tg ON tg.id = atag.tag
    WHERE tg.id = NEW.id`;

const GENRE_TAG_LEVELS = RECORDING_TAG_LEVELS.replaceAll(
  'tg.id = NEW.id',
  'tg.name = NEW.name',
);

export const TRACKED_TABLES: readonly TrackedTable[] = [
  {
    table: 'recording',
    selectNew: 'SELECT NEW.id AS recording_id, NEW.gid AS recording_mbid',
  },
  {
    table: 'recording_gid_redirect',
    selectNew: `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r WHERE r.id = NEW.new_id`,
  },
  byRecordingColumn('track', 'recording'),
  byRecordingColumn('recording_tag', 'recording'),
  byRecordingColumn('l_recording_work', 'entity0'),
  byRecordingColumn('l_recording_url', 'entity0'),
  {
    table: 'artist_credit',
    selectNew: `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r WHERE r.artist_credit = NEW.id`,
  },
  {
    table: 'artist_credit_name',
    selectNew: `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r WHERE r.artist_credit = NEW.artist_credit
    UNION ${releaseCreditRecordings}`,
  },
  byArtistColumn('artist', 'id'),
  byArtistColumn('artist_alias', 'artist'),
  byArtistColumn('artist_tag', 'artist'),
  byRelease('release', 'm.release = NEW.id'),
  byRelease('medium', 't.medium = NEW.id'),
  byRelease('release_country', 'm.release = NEW.release'),
  byRelease('release_unknown_country', 'm.release = NEW.release'),
  ...COVER_SYNC_TABLES,
  {
    table: 'release_group_tag',
    selectNew: `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r
    JOIN musicbrainz.track t ON t.recording = r.id
    JOIN musicbrainz.medium m ON m.id = t.medium
    JOIN musicbrainz.release rel ON rel.id = m.release
    WHERE rel.release_group = NEW.release_group`,
  },
  {
    table: 'work',
    selectNew: `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r
    JOIN musicbrainz.l_recording_work lrw ON lrw.entity0 = r.id
    WHERE lrw.entity1 = NEW.id`,
  },
  {
    table: 'url',
    selectNew: `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r
    JOIN musicbrainz.l_recording_url lru ON lru.entity0 = r.id
    WHERE lru.entity1 = NEW.id`,
  },
  {
    table: 'link',
    selectNew: `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r
    JOIN musicbrainz.l_recording_url lru ON lru.entity0 = r.id
    WHERE lru.link = NEW.id`,
  },
  {
    table: 'link_type',
    selectNew: `SELECT r.id AS recording_id, r.gid AS recording_mbid
    FROM musicbrainz.recording r
    JOIN musicbrainz.l_recording_url lru ON lru.entity0 = r.id
    JOIN musicbrainz.link l ON l.id = lru.link
    WHERE l.link_type = NEW.id`,
  },
  { table: 'tag', selectNew: RECORDING_TAG_LEVELS },
  { table: 'genre', selectNew: GENRE_TAG_LEVELS },
];

const triggerSql = (entry: TrackedTable): string => {
  const trigger = triggerName(entry.table);
  const fn = syncFunctionName(entry.table);
  // Re-enqueueing a Recording that is already (or still) in the outbox
  // re-arms its entry: the same Recording changes again after it was
  // synced, and the drain must pick it up again.
  const enqueue = (select: string, unless: string): string =>
    `INSERT INTO music_catalog.recording_outbox (recording_id, recording_mbid)
  SELECT candidates.recording_id, candidates.recording_mbid
  FROM (${select}) AS candidates WHERE TG_OP <> '${unless}'
  ON CONFLICT (recording_id, recording_mbid) DO UPDATE
  SET enqueued_at = now(), processed_at = NULL;`;
  return `CREATE OR REPLACE FUNCTION music_catalog.${fn}()
  RETURNS trigger LANGUAGE plpgsql AS $func$
BEGIN
  ${enqueue(entry.selectNew, 'DELETE')}
  ${enqueue(selectOld(entry), 'INSERT')}
  RETURN NULL;
END;
$func$;
DROP TRIGGER IF EXISTS ${trigger} ON musicbrainz.${entry.table};
CREATE TRIGGER ${trigger}
  AFTER INSERT OR UPDATE OR DELETE ON musicbrainz.${entry.table}
  FOR EACH ROW EXECUTE FUNCTION music_catalog.${fn}();`;
};

/**
 * The plain SQL the worker runs to install (or replace) every change
 * trigger. Idempotent: functions are replaced, triggers dropped first, and
 * re-enqueueing a Recording re-arms its entry, so running it again (or a
 * change firing twice in one transaction) only schedules one more sync.
 */
export const buildSyncTriggersSql = (): string =>
  TRACKED_TABLES.map(triggerSql).join('\n');

/** A sync trigger found in the database, with the table it watches. */
export type ExistingSyncTrigger = {
  name: string;
  table: string;
};

/** What installing the triggers means given what is already there. */
export type TriggerSyncPlan = {
  /** A trigger is missing or something stale is left: (re)install. */
  reinstall: boolean;
  /** Triggers of tables this version no longer tracks. */
  staleTriggers: ExistingSyncTrigger[];
  /** Sync functions of tables this version no longer tracks. */
  staleFunctions: string[];
};

/**
 * Compares the installed triggers and functions with the tracked set, so
 * the worker only writes when something is missing or stale. Pure: the
 * repository lists what exists and drops what this plans.
 */
export const planTriggerSync = (existing: {
  triggers: readonly ExistingSyncTrigger[];
  functions: readonly string[];
}): TriggerSyncPlan => {
  const expectedTriggers = new Set(
    TRACKED_TABLES.map((entry) => triggerName(entry.table)),
  );
  const expectedFunctions = new Set(
    TRACKED_TABLES.map((entry) => syncFunctionName(entry.table)),
  );
  const missing = [...expectedTriggers].filter(
    (name) => !existing.triggers.some((trigger) => trigger.name === name),
  );
  const staleTriggers = existing.triggers.filter(
    (trigger) => !expectedTriggers.has(trigger.name),
  );
  const staleFunctions = existing.functions.filter(
    (name) => !expectedFunctions.has(name),
  );
  return {
    reinstall:
      missing.length > 0 ||
      staleTriggers.length > 0 ||
      staleFunctions.length > 0,
    staleTriggers,
    staleFunctions,
  };
};
