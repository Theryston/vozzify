# Music catalog deployment

The `Music catalog images` workflow builds both images for pull requests and
publishes `latest` and `sha-<commit>` tags on relevant pushes to `main`.
After the Compose checks and both image publications succeed, its deploy job
asks Coolify to pull the new images and recreate the production stack.
Pull requests never call the production endpoint.

## Coolify configuration

Configure these repository Actions secrets:

| Secret | Value |
| --- | --- |
| `COOLIFY_MUSIC_CATALOG_DEPLOY_URL` | The private Coolify service restart URL, ending in `/api/v1/services/<service-uuid>/restart?latest=true` |
| `COOLIFY_DEPLOY_TOKEN` | A token with only the `deploy` permission for the resource's team |

Use these image references in the saved Coolify Compose definition:

```yaml
services:
  server:
    image: ghcr.io/theryston/vozzify/music-catalog:latest
  mbslave:
    image: ghcr.io/theryston/vozzify/music-catalog-mbslave:latest
```

The server, worker and migration job use the first image; the importer uses
the second. Keep upstream image versions, persistent volumes, environment
variables, internal networking and published ports configured independently.
The Compose in this folder remains the standalone stack template.

The restart URL must include `latest=true`: a normal restart does not pull
new images. The deployment request accepts HTTP or HTTPS, never prints its
URL, token or response body, and fails the job if Coolify rejects the request.
It sends the request once to avoid queuing duplicate deployments after an
ambiguous network failure. A successful request means the deployment was
queued; check the Coolify logs and container health for its completion.

Redeploying during the first import restarts the database restore from the
beginning. Downloaded archives remain in the dumps volume. Once the catalog
is ready, subsequent starts skip the first import and resume replication.

To roll back, set both images to their matching previous `sha-<commit>` tag
and deploy. Read the migration SQL before rolling back across a migration.

## Deployment request tests

```sh
bash .github/scripts/deploy-coolify.test.sh
```

The tests exercise the real request script with a fake curl executable:
successful HTTP and HTTPS calls, POST authentication, missing configuration,
unsupported URL schemes, and private output on network and HTTP failures.
They never contact Coolify or restart a container.

## Initial indexing throughput

The worker defaults to 50,000 Recordings per Meilisearch task. It combines
PostgreSQL reads of at most 10,000 Recordings and prepares at most two tasks
while earlier tasks are still indexing, then confirms them in source order.
The last task may contain fewer documents. Each window retains the catalog
write fence until all its submitted tasks settle. This bounds queued work at
100,000 documents and lets association delivery proceed between windows.
Incremental sync and association indexing remain capped at 10,000 entries.

An existing Coolify Compose definition with an explicit
`INDEXING_BATCH_SIZE: '10000'` must be changed to `'50000'` after deploying an
image that supports the larger tasks. Older images reject values above
10,000. The image default does not override an explicit environment value.
Keep the existing volumes and checkpoint. Once the restore has completed,
worker restarts resume indexing after the last confirmed batch; they do not
repeat the MusicBrainz restore. A failed or uncheckpointed task is replayed
by MBID, replacing the same documents.

Smaller batches reduce memory usage, write-fence hold time and shutdown drain
time. The larger default can retain more documents than the previous three
10,000-document tasks. A worker stop may need to finish up to two tasks;
allow those tasks to settle before restarting when possible. A forced stop
can replay uncheckpointed documents. No search settings change, and existing
indexes do not need rebuilding. To roll back to an older image, first restore
`INDEXING_BATCH_SIZE` to a value of at most 10,000.
