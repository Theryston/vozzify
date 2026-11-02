# Public asset delivery

The public URL for vozzify-owned files is configured by the API's existing
`S3_PUBLIC_URL`. In production set it to
`https://assets.vozzify.com/storage`; API uploads and signed uploads still use
its S3-compatible R2 credentials. The `vozzify-asset-proxy` Worker reads the
same production R2 bucket through its `PUBLIC_ASSETS` native binding.

Locally, the API continues using MinIO and its bucket URL. Wrangler's local R2
binding is separate, so Worker fixtures must be uploaded through Wrangler and
are not implicitly copied from MinIO. See [the asset proxy guide](../../apps/asset-proxy/README.md).
