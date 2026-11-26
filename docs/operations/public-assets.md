# Public asset delivery

The public URL for vozzify-owned files is configured by the API's existing
`S3_PUBLIC_URL`. In production set it to
`https://assets.vozzify.com/storage`; API uploads and signed uploads still use
its S3-compatible R2 credentials. The `vozzify-asset-proxy` Worker reads the
same production R2 bucket through its `PUBLIC_ASSETS` native binding.

Locally, the API continues using MinIO and its bucket URL. Wrangler's local R2
binding is separate, so Worker fixtures must be uploaded through Wrangler and
are not implicitly copied from MinIO. See [the asset proxy guide](../../apps/asset-proxy/README.md).

## User uploads

The API stores assets from a user's private library in `S3_BUCKET` and returns
playback URLs under `S3_PUBLIC_URL` to the eligible owner. Anyone with the asset
URL can play the audio. The library, track details and practice history still
require the owner's session.

When upgrading from the separate bucket, pause private track writers and let
in-flight processing finish. Using the database and storage settings for the
environment being upgraded, run the copy before starting the new API. Set
`S3_PRIVATE_BUCKET` if the original name differs from `${S3_BUCKET}-private`.

```sh
# From apps/api in a source checkout
nub run storage:migrate-private-tracks

# Or from /app/apps/api in the built API image
node dist/database/migrate-private-track-assets.js
```

The copy preserves the keys stored in the database, skips existing destination
objects and leaves the original bucket intact for rollback. The migration
credentials need read access to the original bucket and write access to the
shared bucket. Close the rollback window before retiring the original bucket.

Music catalog release and release-group covers use the registered
`/cover-art-archive/` provider at the same domain. Publish the Worker with this
provider before deploying the Music catalog change that emits those URLs.
The provider resolves the Cover Art Archive redirects itself and caches
successful images for 30 days; it does not copy them into R2.
