// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdsenseConfig } from '@/lib/env/adsense-config';
import { allowedAdConsent } from './consent-fixture';

const config: AdsenseConfig = {
  client: 'ca-pub-1234567890123456',
  slot: '1234567890',
  layoutKey: '-fb+5w+4e-db+86',
  cmpUrl: 'https://cmp.example.test/cmp.js',
};

type TcfCallback = (data: unknown, success: boolean) => void;
type TcfApi = (
  command: string,
  version: number,
  callback: TcfCallback,
  listenerId?: number,
) => void;

const loadRuntime = async () => {
  vi.resetModules();
  document.head.replaceChildren();
  return import('./ad-runtime');
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const captureScripts = (): HTMLScriptElement[] => {
  const scripts: HTMLScriptElement[] = [];
  vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
    for (const node of nodes) {
      if (node instanceof HTMLScriptElement) scripts.push(node);
    }
  });
  return scripts;
};

describe('AdSense runtime', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (window as Window & { __tcfapi?: TcfApi }).__tcfapi;
    delete (window as Window & { adsbygoogle?: unknown[] }).adsbygoogle;
  });

  it('loads the configured CMP and waits for its TCF API', async () => {
    const { loadCmp } = await loadRuntime();
    const scripts = captureScripts();
    const result = loadCmp(config);
    const script = scripts[0];
    if (!script) throw new Error('Expected CMP script');
    expect(script.src).toBe(config.cmpUrl);
    (window as Window & { __tcfapi?: TcfApi }).__tcfapi = () => {};
    script.dispatchEvent(new Event('load'));
    expect(await result).toBeTypeOf('function');
  });

  it('times out when a loaded CMP never exposes TCF', async () => {
    vi.useFakeTimers();
    const { loadCmp } = await loadRuntime();
    const scripts = captureScripts();
    const result = loadCmp(config);
    scripts[0]?.dispatchEvent(new Event('load'));
    const rejection = expect(result).rejects.toThrow(
      'Consent platform did not expose the TCF API',
    );
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });

  it('subscribes to TCF updates and removes the exact listener on cleanup', async () => {
    const { subscribeToTcfChoice } = await loadRuntime();
    let listener: TcfCallback | undefined;
    const calls: Array<[string, number, TcfCallback, number | undefined]> = [];
    const api: TcfApi = (command, version, callback, listenerId) => {
      calls.push([command, version, callback, listenerId]);
      listener = callback;
    };
    const onChoice = vi.fn();
    const unsubscribe = subscribeToTcfChoice(api, onChoice);
    listener?.(
      {
        ...allowedAdConsent,
        listenerId: 42,
      },
      true,
    );
    await flush();
    expect(onChoice).toHaveBeenCalledWith('personalized');
    unsubscribe();
    expect(calls.at(-1)?.slice(0, 2)).toEqual(['removeEventListener', 2]);
    expect(calls.at(-1)?.[3]).toBe(42);
    listener?.({ eventStatus: 'useractioncomplete', gdprApplies: false }, true);
    expect(onChoice).toHaveBeenCalledTimes(1);
  });

  it('ignores unsuccessful and malformed TCF events', async () => {
    const { subscribeToTcfChoice } = await loadRuntime();
    let listener: TcfCallback | undefined;
    const api: TcfApi = (_command, _version, callback) => {
      listener = callback;
    };
    const onChoice = vi.fn();
    subscribeToTcfChoice(api, onChoice);
    listener?.({}, false);
    listener?.({ eventStatus: 'cmpuishown', gdprApplies: true }, true);
    expect(onChoice).not.toHaveBeenCalled();
  });

  it('accepts reduced successful TCData when GDPR does not apply', async () => {
    const { subscribeToTcfChoice } = await loadRuntime();
    let listener: TcfCallback | undefined;
    const api: TcfApi = (_command, _version, callback) => {
      listener = callback;
    };
    const onChoice = vi.fn();
    subscribeToTcfChoice(api, onChoice);
    listener?.({ gdprApplies: false }, true);
    expect(onChoice).toHaveBeenCalledWith('non-personalized');
  });

  it('sets request controls before loading the provider and handles queue controls', async () => {
    const {
      loadAdSense,
      pauseAdSenseRequests,
      requestInFeedAd,
      resumeAdSenseRequests,
    } = await loadRuntime();
    const scripts = captureScripts();
    const loaded = loadAdSense(config, 'non-personalized');
    const queue = (
      window as Window & {
        adsbygoogle?: Array<Record<string, never>> & {
          pauseAdRequests?: number;
          requestNonPersonalizedAds?: number;
        };
      }
    ).adsbygoogle;
    if (!queue) throw new Error('Expected AdSense queue');
    expect(queue.pauseAdRequests).toBe(1);
    expect(queue.requestNonPersonalizedAds).toBe(1);
    const script = scripts[0];
    if (!script) throw new Error('Expected AdSense script');
    expect(script.async).toBe(true);
    expect(script.src).toContain(config.client);
    script.dispatchEvent(new Event('load'));
    await loaded;
    requestInFeedAd();
    expect(queue).toHaveLength(1);
    resumeAdSenseRequests();
    expect(queue.pauseAdRequests).toBe(0);
    pauseAdSenseRequests();
    expect(queue.pauseAdRequests).toBe(1);
  });

  it('rejects provider load failures and safely handles a missing request queue', async () => {
    const { loadAdSense, requestInFeedAd } = await loadRuntime();
    const scripts = captureScripts();
    requestInFeedAd();
    const loaded = loadAdSense(config, 'personalized');
    scripts[0]?.dispatchEvent(new Event('error'));
    await expect(loaded).rejects.toThrow('Unable to load vozzify-adsense');
  });
});
