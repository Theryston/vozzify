import type { AdsenseConfig } from '@/lib/env/adsense-config';

import {
  type AdConsent,
  adConsentFromTcf,
  type PublisherRestrictions,
  type TcfConsentData,
} from './consent';

type TcfApi = (
  command: string,
  version: number,
  callback: (data: unknown, success: boolean) => void,
  parameter?: number,
) => void;

type AdSenseQueue = Array<Record<never, never>> & {
  pauseAdRequests?: number;
  requestNonPersonalizedAds?: number;
};

type RuntimeWindow = Window & {
  __tcfapi?: TcfApi;
  adsbygoogle?: AdSenseQueue;
};

const scriptLoaders = new Map<string, Promise<void>>();

function loadScript(id: string, source: string): Promise<void> {
  const existing = scriptLoaders.get(id);
  if (existing !== undefined) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = id;
    script.src = source;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Unable to load ${id}`));
    document.head.append(script);
  });
  scriptLoaders.set(id, promise);
  return promise;
}

/** Loads the separately configured Google CMP before touching the ad tag. */
export async function loadCmp(config: AdsenseConfig): Promise<TcfApi> {
  await loadScript('vozzify-adsense-cmp', config.cmpUrl);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const tcfApi = (window as RuntimeWindow).__tcfapi;
    if (tcfApi) return tcfApi;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  throw new Error('Consent platform did not expose the TCF API');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseBooleanMap(value: unknown): Record<number, boolean> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const entries = Object.entries(value).flatMap(([key, entry]) => {
    const id = Number(key);
    return Number.isInteger(id) && typeof entry === 'boolean'
      ? [[id, entry] as const]
      : [];
  });
  return Object.fromEntries(entries);
}

function parseRestrictions(value: unknown): PublisherRestrictions {
  if (!isRecord(value)) return {};
  const parsed: Record<number, Record<number, 0 | 1 | 2>> = {};
  for (const [purposeId, vendors] of Object.entries(value)) {
    const purposeNumber = Number(purposeId);
    if (!Number.isInteger(purposeNumber) || !isRecord(vendors)) continue;
    const allowed: Record<number, 0 | 1 | 2> = {};
    for (const [vendorId, restriction] of Object.entries(vendors)) {
      const vendorNumber = Number(vendorId);
      if (
        Number.isInteger(vendorNumber) &&
        (restriction === 0 || restriction === 1 || restriction === 2)
      ) {
        allowed[vendorNumber] = restriction;
      }
    }
    parsed[purposeNumber] = allowed;
  }
  return parsed;
}

function parseTcfConsentData(value: unknown): TcfConsentData | undefined {
  if (
    !isRecord(value) ||
    (typeof value.eventStatus !== 'string' && value.gdprApplies !== false)
  )
    return undefined;
  const purpose = isRecord(value.purpose) ? value.purpose : undefined;
  const vendor = isRecord(value.vendor) ? value.vendor : undefined;
  const publisher = isRecord(value.publisher) ? value.publisher : undefined;
  return {
    ...(typeof value.listenerId === 'number'
      ? { listenerId: value.listenerId }
      : {}),
    ...(typeof value.gdprApplies === 'boolean'
      ? { gdprApplies: value.gdprApplies }
      : {}),
    ...(typeof value.eventStatus === 'string'
      ? { eventStatus: value.eventStatus }
      : {}),
    ...(purpose
      ? {
          purpose: {
            consents: parseBooleanMap(purpose.consents),
            legitimateInterests: parseBooleanMap(purpose.legitimateInterests),
          },
        }
      : {}),
    ...(vendor
      ? {
          vendor: {
            consents: parseBooleanMap(vendor.consents),
            legitimateInterests: parseBooleanMap(vendor.legitimateInterests),
          },
        }
      : {}),
    ...(publisher
      ? {
          publisher: {
            restrictions: parseRestrictions(publisher.restrictions),
          },
        }
      : {}),
  };
}

export function subscribeToTcfChoice(
  tcfApi: TcfApi,
  onChoice: (choice: AdConsent) => void,
): () => void {
  let active = true;
  let listenerId: number | undefined;
  const callback = (value: unknown, success: boolean) => {
    if (!success || !active) return;
    const data = parseTcfConsentData(value);
    if (!data) return;
    const choice = adConsentFromTcf(data);
    if (choice) onChoice(choice);
    if (typeof data.listenerId === 'number') listenerId = data.listenerId;
  };
  tcfApi('addEventListener', 2, callback);
  return () => {
    active = false;
    if (listenerId !== undefined) {
      tcfApi('removeEventListener', 2, () => {}, listenerId);
    }
  };
}

/** The tag is injected only after eligibility and a supported consent signal. */
export async function loadAdSense(
  config: AdsenseConfig,
  consent: Exclude<AdConsent, 'denied'>,
): Promise<void> {
  let queue = (window as RuntimeWindow).adsbygoogle;
  if (queue === undefined) {
    queue = [];
    (window as RuntimeWindow).adsbygoogle = queue;
  }
  queue.pauseAdRequests = 1;
  if (consent === 'non-personalized') queue.requestNonPersonalizedAds = 1;
  else queue.requestNonPersonalizedAds = 0;
  await loadScript(
    'vozzify-adsense',
    `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.client}`,
  );
}

export function resumeAdSenseRequests(): void {
  const queue = (window as RuntimeWindow).adsbygoogle;
  if (queue) queue.pauseAdRequests = 0;
}

export function pauseAdSenseRequests(): void {
  const queue = (window as RuntimeWindow).adsbygoogle;
  if (queue) queue.pauseAdRequests = 1;
}

export function requestInFeedAd(): void {
  const queue = (window as RuntimeWindow).adsbygoogle;
  if (!queue) return;
  queue.push({});
}
