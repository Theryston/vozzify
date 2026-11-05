# Import legacy favorites and views

Run this stage after the recording plan is complete and every planned
recording group has been prepared. It reads the durable `legacy_track_ids`
mapping, so mapped favorites and views can be imported while their destination
Tracks are still queued, running, or failed. Public favorites continue to list
only Tracks with completed Processing.

The stage uses the read-only legacy Postgres connection and the destination
Postgres connection. It also uses the normal API Redis queue for cache and
personal-home refreshes. Load the normal API environment, including
`DATABASE_URL`, `REDIS_URL`, and `LEGACY_DATABASE_URL`, then apply destination
migrations and build the API before running:

```sh
nub run --filter=api build
nub run --filter=api import:legacy-relationships
```

The command is safe to rerun. It stores a source fingerprint and separate
favorite, view, and view-score-refresh cursors. If a planned Track has no
`legacy_track_ids` row yet, it leaves that source page retryable and reports
`RELATIONSHIP_MAP_PENDING`; prepare the remaining recording groups, then rerun.
A changed legacy source stops the stage with `RELATIONSHIP_SOURCE_CHANGED`.

The report distinguishes source and destination counts:

- `acceptedFavorites` counts source rows with a mapped Track.
- `importedFavorites` counts new destination `(User, Track)` pairs.
- `deduplicatedFavorites` counts accepted rows that converged on a destination
  pair already imported, using earliest `createdAt` and then the source favorite
  ID as the tie-breaker.
- `skippedFavorites` and `skippedViews` count rows whose planned source Track
  was definitively skipped.
- `skippedLegacyTracks` lists skipped source Track IDs and their source
  favorite and view counts.

Views retain their source IDs and timestamps, including anonymous views.
`locale`, click attribution, and visitor attribution remain null. After writing
views, the command recomputes trending scores through the normal Track trending
service. Favorite writes also queue personal-home refreshes and profile-cache
revalidation through their normal services.
