# Reconcile legacy Artist and Album URLs

After the legacy Recording plan is complete and its imported Tracks have
finished metadata jobs, run the destination-only map command from `apps/api`:

```sh
nub run import:legacy-catalog-maps
```

The command uses `DATABASE_URL`, `LEGACY_DATABASE_URL`, and `REDIS_URL`. It
reads the frozen Track snapshots saved by the plan and takes a read-only,
repeatable-read snapshot of every source Artist and Album, checks the metadata
queue, and fills `legacy_artist_ids` and `legacy_album_ids`. It does not call
MusicBrainz, start Processing workers, or call paid providers. The API's
existing metadata worker handles any work the command requeues.

An Artist is mapped only when every planned Track for that legacy Artist has a
completed metadata job and the persisted source-credit MBID resolution ties
that exact credit name to one canonical MusicBrainz Artist MBID across all
those Tracks. This preserves Artist merges without guessing from another
same-name credit. An Album is mapped only when every planned Track for that
legacy Album has a completed metadata job and its actual release-group links
have one exact title, one shared release-group MBID, and an Artist identity in
common with the accepted Recording across all those Tracks. Multiple legacy
IDs may map to the same destination entity.

Metadata outcome is stored on each imported Recording group, so the decision
survives BullMQ's job retention. A missing or failed metadata job is requeued
with the normal metadata job ID; the command reports that source identity as
pending until an API metadata worker finishes it. An ambiguous identity or an
identity without a match is reported unresolved only after all planned Track
metadata imports are durably marked complete. Tracks skipped by the Recording
plan do not block evidence from other planned Tracks; an entity seen only on
skipped Tracks is unresolved with reason `recording-plan-skipped`. Other
pending reasons are `recording-not-imported`, `metadata-import-failed`,
`metadata-import-pending`, and `metadata-entity-not-imported`.

Migration `0056_fat_crystal` resets imported metadata status to pending once so
the normal metadata worker can populate the durable source-credit resolutions.
Run the catalog-map command again after those jobs finish.
Legacy source Artist or Album rows with no Track occurrence are reported as
unresolved with reason `no-planned-track`; conflicting names on one legacy ID
are reported with reason `legacy-name-conflict`.

The command is safe to rerun. Existing map rows must resolve to the same
destination ID; a conflicting replay fails instead of changing a public URL.
Mapped IDs are derived from the legacy map tables, deliberately skipped IDs
from the frozen plan and exact metadata evidence, and pending IDs from the
durable metadata status plus the still-missing destination Track or entity.
