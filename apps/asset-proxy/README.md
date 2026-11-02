# Asset proxy

The `vozzify-asset-proxy` Cloudflare Worker serves vozzify-owned public objects
from the `PUBLIC_ASSETS` native R2 binding at
`https://assets.vozzify.com/storage/<object-key>`. The `storage` route streams
R2 objects without S3 credentials. Uploads, signed uploads and API-side reads
remain on the API's S3-compatible storage integration, which still needs R2's
S3 endpoint credentials in production. Cover Art Archive release and
release-group covers are served through the registered
`/cover-art-archive/` provider at the same asset domain; it follows the
archive's redirects internally and retains successful images for 30 days.

Successful storage responses are fresh in the Worker's Cache API for three
hours. Cache entries are retained for up to four hours so the Worker can read
an expired application entry and return it while demand-driven revalidation
runs in the background. A successful revalidation replaces changed bytes or
confirms unchanged bytes with the origin validator and starts a new three-hour
window. A missing object, failed origin read or ten-second revalidation timeout
evicts the old entry from that cache location; the next request retries R2.
The request that starts a refresh can still receive the old representation.
Cache entries and eviction are local to the serving Cloudflare datacenter, so
there is no global purge or globally coordinated refresh. Cache API eviction
may happen earlier, in which case the request simply reads R2 and can be
admitted again. Cache admission is best effort under Cloudflare's object-size
and execution limits; responses remain streamed when an object cannot be
cached. Browser responses retain `public, max-age=0, must-revalidate`, so every
reuse still reaches the Worker even while its internal edge entry is fresh.

## Local development

From the repository root:

```sh
nub install
nub run dev --filter=asset-proxy
nub run test:e2e --filter=asset-proxy
nub run build --filter=asset-proxy
```

Wrangler's local runtime creates an isolated local R2 bucket for Worker tests;
it is intentionally separate from the API's MinIO bucket. For a manual smoke
test, run the Worker and seed fixtures from `apps/asset-proxy` so Wrangler
uses this app's binding configuration:

```sh
nub run smoke:fixtures
nub exec wrangler r2 object put vozzify-public-assets/smoke/tone.wav \
  --file tmp/smoke-fixtures/tone.wav --local
nub exec wrangler r2 object put vozzify-public-assets/smoke/pitch.bin \
  --file tmp/smoke-fixtures/pitch.bin --local
```

In separate terminals from the same directory run `nub run dev`,
`nub run smoke:web`, then open `http://localhost:8788`. The page requests the
binary pitch fixture with browser `fetch`, and provides an anonymous audio
player plus a button that seeks in the tiny generated WAV. The browser console
shows any failed CORS or playback requests. A direct range check is also
available:

```sh
curl -i -H 'Range: bytes=0-63' \
  http://localhost:8787/storage/smoke/tone.wav
```

No production object or large download is needed.

## Production prerequisites

Create the R2 bucket `vozzify-public-assets`, bind it as `PUBLIC_ASSETS`, and
attach `assets.vozzify.com` as a Workers custom domain in Cloudflare. DNS and
deployment are operator steps. Publish the Worker with the storage and
`cover-art-archive` providers before deploying the Music catalog version that
emits cover URLs under `/cover-art-archive/`. The catalog derives these URLs
from MBIDs at response time. Set the API's `S3_PUBLIC_URL` to
`https://assets.vozzify.com/storage`; API S3-compatible endpoint, region,
bucket and credentials continue to configure upload, presign and backend
read operations. The Worker uses only the native binding and has no secret.
