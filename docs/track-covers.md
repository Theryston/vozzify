# Track cover selection and repair

The Music catalog selects a Recording's primary release with these preferences,
in order: releases outside Compilation groups, groups crediting at least one
of the Recording's artists, then Official releases. Among equally preferred
releases, the earliest date wins; an incomplete date sorts after known dates
in its own period (`2014-06-20` before `2014`, `2014-06-20` before `2014-06`).
Undated releases sort last, with title, MBID and track positions breaking ties.
All releases remain eligible, including Recordings available only on compilations.
Cover ordering compares all release events after applying the precision rule;
the displayed date and country retain their existing event-selection policy.

Search shows that release's Cover Art Archive front cover. Track import
preserves the first release's MBID from `getRecording`, which uses the same
selection as the search index. Internal ranking fields stay out of the protocol.

If the release has no cover, the Track uses the thumbnail of its chosen YouTube
video. It never takes artwork from an unrelated YouTube Music search result.

## Repair existing Tracks

Older Tracks discarded month/day and could choose a compilation from the same
year. Their correct primary release cannot be recovered from API data alone.
The operator repair command fetches each Recording from the Music catalog,
follows bounded merge chains and replaces its cover using the current catalog
choice. It does not run note detection or change the chosen video.

Deploy the updated Music catalog server and worker before running the repair.
The command reads `getRecording` live, so it uses the new selection even before
existing search documents have been refreshed. Deploying only the API leaves
the old cover choice in place.

Apply the database migration and build the API before running the repair. From
`apps/api`, with the usual database, Music catalog, storage, Redis and web
revalidation environment configured:

```sh
nub run db:migrate
nub run build
nub run repair:track-covers
```

In the production image, run the built command intentionally after deployment:

```sh
node dist/main.js --repair-track-covers
```

The command scans Tracks in ID order, one small page at a time, and processes
covers sequentially. It starts a dedicated Nest context for the repair and web
revalidation queue, without the audio-processing workers or HTTP listener.
Each failed Recording lookup or cover replacement is logged, other Tracks
continue, and any failed Track makes the command exit unsuccessfully after
the scan. Fix the dependency failure and rerun the command.

The previous cover remains referenced if downloading, decoding or uploading
the replacement fails. Repaired covers use versioned storage keys so browser
and CDN caches cannot keep the prior bytes under the new URL. The command
queues Track and catalog cache invalidations even when a rerun finds the
correct cover already stored; queued invalidations use the normal web
revalidation retries.

Existing cover objects are retained in storage. To roll back a repaired Track,
restore its previous cover URL from the database backup taken before repair,
then invalidate `cacheTags.track(trackId)` and `cacheTags.tracks`. The schema
change is additive, so rolling back application code does not require dropping
the primary-release column.

This command is an explicit operator action; deploying the fix alone does not
rewrite previously stored covers.

## Refresh existing search covers

Search reads the stored Meilisearch document, independently of the API's stored
Track cover. A selection-rule deployment alone does not rewrite that document.
After deploying the Music catalog, enqueue a bounded set of affected Recordings
in its database while the worker runs. For example, this repairs the reported
Recording without reimporting MusicBrainz or interrupting search:

```sql
INSERT INTO music_catalog.recording_outbox (recording_id, recording_mbid)
SELECT id, gid FROM musicbrainz.recording
WHERE gid = '9037fd5b-e74f-49c9-90aa-9c8d08ee160a'
ON CONFLICT (recording_id, recording_mbid) DO UPDATE
SET enqueued_at = now(), processed_at = NULL;
```

For existing API Tracks, use the same statement with this SELECT instead:

```sql
SELECT r.id, r.gid FROM musicbrainz.recording r
JOIN music_catalog.track_association a ON a.recording_mbid = r.gid
WHERE a.track_id IS NOT NULL
```

The worker refreshes these documents through its normal incremental batches.
For every Recording, including those without a Track, use the full index rebuild
documented in `apps/music-catalog/CLAUDE.md` under Backups and recovery. That
rebuild reads the existing database; it does not restore dumps or process audio.
