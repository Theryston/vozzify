# Asset proxy

The `vozzify-asset-proxy` Cloudflare Worker serves vozzify-owned public objects
from the `PUBLIC_ASSETS` native R2 binding at
`https://assets.vozzify.com/storage/<object-key>`. The `storage` route streams
R2 objects without S3 credentials. Uploads, signed uploads and API-side reads
remain on the API's S3-compatible storage integration, which still needs R2's
S3 endpoint credentials in production.

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
deployment are operator steps. Set the API's `S3_PUBLIC_URL` to
`https://assets.vozzify.com/storage`; API S3-compatible endpoint, region,
bucket and credentials continue to configure upload, presign and backend
read operations. The Worker uses only the native binding and has no secret.
