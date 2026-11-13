import type { AdsenseConfig } from './adsense-config';
import { getServerEnv } from './server';

let cached: AdsenseConfig | null | undefined;

/** Incomplete account setup stays inert, including in production. */
export function getAdsenseConfig(): AdsenseConfig | undefined {
  if (cached !== undefined) return cached ?? undefined;
  const env = getServerEnv();
  if (
    !env.ADSENSE_ENABLED ||
    !env.ADSENSE_CLIENT ||
    !env.ADSENSE_SLOT ||
    !env.ADSENSE_LAYOUT_KEY ||
    !env.ADSENSE_CMP_URL
  ) {
    cached = null;
    return undefined;
  }
  cached = {
    client: env.ADSENSE_CLIENT,
    slot: env.ADSENSE_SLOT,
    layoutKey: env.ADSENSE_LAYOUT_KEY,
    cmpUrl: env.ADSENSE_CMP_URL,
  };
  return cached;
}
