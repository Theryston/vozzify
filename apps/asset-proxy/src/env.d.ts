// biome-ignore lint/style/noNamespace: Cloudflare generates its runtime types in this namespace.
declare namespace Cloudflare {
  // biome-ignore lint/style/useConsistentTypeDefinitions: this interface merges with Cloudflare's generated Env.
  interface Env {
    PUBLIC_ASSETS: R2Bucket;
  }
}
