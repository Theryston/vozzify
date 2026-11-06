import {
  buildSyncTriggersSql,
  planTriggerSync,
  syncFunctionName,
  TRACKED_TABLES,
  triggerName,
} from './sync-tracked-tables.js';

// The tables whose changes reach a Recording's document (issue #61): the
// Recording itself and every table the indexed document reads.
const EXPECTED_TABLES = [
  'recording',
  'recording_gid_redirect',
  'recording_tag',
  'artist_credit',
  'artist_credit_name',
  'artist',
  'artist_alias',
  'artist_tag',
  'release',
  'medium',
  'track',
  'release_country',
  'release_unknown_country',
  'release_group',
  'release_group_secondary_type_join',
  'release_group_secondary_type',
  'release_status',
  'release_group_tag',
  'work',
  'l_recording_work',
  'url',
  'link',
  'l_recording_url',
  'link_type',
  'tag',
  'genre',
];

describe('the sync triggers', () => {
  it('watches every table that feeds a Recording document', () => {
    expect(TRACKED_TABLES.map((entry) => entry.table).sort()).toEqual(
      [...EXPECTED_TABLES].sort(),
    );
  });

  it('installs one trigger per table, idempotently and deduplicating', () => {
    const sql = buildSyncTriggersSql();

    for (const table of EXPECTED_TABLES) {
      expect(sql).toContain(`CREATE TRIGGER ${triggerName(table)}`);
      expect(sql).toContain(`ON musicbrainz.${table}`);
    }
    expect(sql).toContain('CREATE OR REPLACE FUNCTION');
    expect(sql).toContain('DROP TRIGGER IF EXISTS');
    // Re-enqueueing re-arms the entry instead of ignoring the change.
    expect(sql).toContain(
      'ON CONFLICT (recording_id, recording_mbid) DO UPDATE',
    );
    expect(sql).toContain('processed_at = NULL');
  });

  it('enqueues both images of a changed row, so deletes and moved links are caught', () => {
    const sql = buildSyncTriggersSql();

    expect(sql).toContain("WHERE TG_OP <> 'DELETE'");
    expect(sql).toContain("WHERE TG_OP <> 'INSERT'");
    expect(sql).toContain('OLD.recording');
  });
});

describe('planTriggerSync', () => {
  const installed = () => ({
    triggers: TRACKED_TABLES.map((entry) => ({
      name: triggerName(entry.table),
      table: entry.table,
    })),
    functions: TRACKED_TABLES.map((entry) => syncFunctionName(entry.table)),
  });

  it('does nothing when every trigger and function is in place', () => {
    expect(planTriggerSync(installed())).toEqual({
      reinstall: false,
      staleTriggers: [],
      staleFunctions: [],
    });
  });

  it('reinstalls when a trigger is missing', () => {
    const existing = installed();
    const plan = planTriggerSync({
      ...existing,
      triggers: existing.triggers.filter(
        (trigger) => trigger.name !== triggerName('track'),
      ),
    });

    expect(plan.reinstall).toBe(true);
    expect(plan.staleTriggers).toEqual([]);
    expect(plan.staleFunctions).toEqual([]);
  });

  it('drops a trigger of a table this version no longer tracks, then reinstalls', () => {
    const existing = installed();
    const plan = planTriggerSync({
      ...existing,
      triggers: [
        ...existing.triggers,
        { name: 'vozzify_sync_retired', table: 'isrc' },
      ],
    });

    expect(plan.reinstall).toBe(true);
    expect(plan.staleTriggers).toEqual([
      { name: 'vozzify_sync_retired', table: 'isrc' },
    ]);
  });

  it('drops a function of a table this version no longer tracks, then reinstalls', () => {
    const existing = installed();
    const plan = planTriggerSync({
      ...existing,
      functions: [...existing.functions, 'sync_outbox_from_retired'],
    });

    expect(plan.reinstall).toBe(true);
    expect(plan.staleTriggers).toEqual([]);
    expect(plan.staleFunctions).toEqual(['sync_outbox_from_retired']);
  });
});
