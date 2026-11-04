# Staged NoteFinder cutover

This workflow composes the imports and Processing operations from #456–#462.
The operator commands enqueue work; the normal API workers consume metadata
and Processing jobs. Preparation never starts paid Processing automatically.

## Before running

1. Rehearse against a tiny fixture or isolated restored snapshot first. Build
   the API from the migration branch with `nub run build --filter=api`.
2. At the agreed cutover time, manually stop NoteFinder writes, workers and
   scheduled jobs. Capture a consistent source backup and retain it. These
   commands do not stop NoteFinder or remove its database.
3. Restore that backup to a separate frozen source database. Grant a dedicated
   role only `SELECT` on the tables listed in
   [the import guide](./import-legacy-users.md). Every source transaction is
   repeatable-read and read-only; keep this same snapshot across retries.
4. Back up the destination before the first import. Apply all committed API
   migrations separately. The first import requires an empty destination
   apart from migration-seeded Plan reference rows and the migration ledger.
5. Keep public traffic and other destination writers off during preparation.
   Run only one operator workflow at a time. Metadata workers may consume
   queued metadata jobs; Processing remains queued until explicitly started.

Load configuration through the shell or a private uncommitted env file.
Use `NODE_ENV=production` for cutover, or `NODE_ENV=test` for a local rehearsal;
these modes read the process environment without loading `apps/api/.env`.
Outside these modes, stages using the normal API configuration can also load
that file. Required values
are `DATABASE_URL` (destination), `LEGACY_DATABASE_URL` (frozen read-only
source), `REDIS_URL`, `MUSIC_CATALOG_URL` and `MUSIC_CATALOG_API_KEY`.
Preparation uses the normal API environment for the existing Track services:
configure the `S3_*` storage group and normal API/auth settings as documented
in `apps/api/.env.example`. Use appropriate TLS connection parameters.
Never store credentials in reports or commit env files.

## Prepare and inspect

From `apps/api`:

```sh
nub run legacy:cutover prepare
nub run legacy:cutover status
```

`prepare` runs User/sign-in import, independent Practice days and privacy,
Recording decisions, preparation of each accepted Recording group, favorites
and views, then Artist/Album map reconciliation. It uses the existing durable
checkpoints. Repeating it resumes committed work without erasing destination
records, overwriting new-app passwords, changing the original Contributor,
or recreating maps and relationships. An incomplete User stage stops before
catalog work. A transient catalog outage leaves undecided Tracks pending;
it does not create catalog skips.

Each run emits a JSON object marked `cutover: true`. Keep that report private:
it contains source/destination IDs and exclusion reasons, though no passwords,
OAuth tokens or connection URLs. `ready` means Users and independent data are
imported, accepted Tracks and Track maps exist, required relationships are
imported, and every excluded Track is an explicit skip. `prepare` exits with
code 1 if preparation is incomplete. Inspect the report before proceeding.

`ready: true` permits a staged launch even with `finished: false`. Existing
public Track pages show their normal queued, running, completed or failed
states. Favorites keep their existing completed-only read behavior; their
relationships are imported before Processing completes. Explicitly skipped
Track, Artist and Album URLs may return 404. Pending work remains pending.

During a staged launch, a legacy Artist/Album URL whose map is still pending
can temporarily answer `NOT_FOUND` until metadata and reconciliation finish.
The report keeps that identity pending, never skipped, and `finished` stays
false. To preserve those redirects from the moment traffic opens, wait for
both auxiliary-map pending counts to reach zero before opening traffic.

`status` also reconciles auxiliary maps and requeues missing/failed metadata
through the existing metadata queue. It starts no Processing. Run normal API
metadata workers, then repeat status to observe their outcomes.

## Continue after readiness

Set `LEGACY_PROCESSING_CONCURRENCY` consistently on the API workers and operator
environment (default 2, allowed 1–10). Configure the normal Redis, storage,
YouTube proxy, RunPod and lyrics integrations before explicitly starting paid
work. For a rehearsal, use fake external providers; implementation tests never
call paid services.

```sh
nub run legacy:cutover continue
```

`continue` refuses to start Processing before readiness. Each invocation runs
one bounded admission/recovery cycle and prints the current reconciled report;
repeat it as work finishes. For continuous polling, use the existing command:

```sh
nub run drain:legacy-processing-backlog
nub run legacy:cutover status
```

The separate backlog command drains prepared migration attempts only; it does
not itself certify launch readiness. See
[the backlog guide](./legacy-processing-backlog.md) for admission recovery and
graceful draining after a concurrency decrease. Saved external job IDs are
polled by the existing pipeline; restarting the operator does not submit a new
RunPod job for an attempt that already has one.

`finished` requires readiness, terminal Processings, completed required
metadata, and auxiliary maps with explicit mapped or skipped outcomes.
Failures remain retained Processings with their Track, attribution and maps;
they never retroactively become catalog skips. Inspect failure codes on
`GET /v1/tracks/<destination-id>/processing`. For an explicitly chosen retryable
failure, use `nub run retry:legacy-recording <recording-mbid>` and then inspect
status again. Neither continue nor status automatically retries final failures.

## Recovery

After interruption, connectivity failure or queue failure, fix the cause and
rerun the same stage against the same source/destination. Do not delete progress
rows, maps, admissions or saved external job identities. Source fingerprint
changes block progress; restore the original frozen snapshot rather than
changing it underneath an import. Reports reconcile source totals, imported
groups, duplicates, retained/deduplicated favorites, views, skips, pending work
and terminal Processing outcomes. Inspect individual Track and auxiliary-map
IDs and reasons before accepting any exclusion.

Manual destination snapshot restoration is a separate maintainer action,
performed only after stopping destination writers and workers and assessing
any new-app writes since that snapshot. No workflow command restores backups,
truncates populated destination tables or deletes the source. Once the new app
accepts writes, recovery must account for those writes instead of blindly
restarting the migration. Retain source and destination backups according to
the maintainer's retention policy.
