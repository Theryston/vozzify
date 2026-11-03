# Track cover selection and repair

The Music catalog selects a Recording's primary release by its full release
date, then title and MBID. Search shows that release's Cover Art Archive front
cover. Track import preserves the first release's MBID from `getRecording`,
which has that same ordering, instead of choosing again from year-only metadata.

If the release has no cover, the Track uses the thumbnail of its chosen YouTube
video. It never takes artwork from an unrelated YouTube Music search result.

## Repair existing Tracks

Older Tracks discarded month/day and could choose a compilation from the same
year. Their correct primary release cannot be recovered from API data alone.
The operator repair command fetches each Recording from the Music catalog,
follows bounded merge chains and replaces its cover using the current catalog
choice. It does not run note detection or change the chosen video.

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
