// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHomeTracking } from './home-tracking';
import { HomeImpressionQueue } from './impression-queue';

vi.mock('@/lib/env/client', () => ({
  getClientEnv: () => ({ NEXT_PUBLIC_API_URL: 'https://api.test' }),
}));

class TestIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('home outcome attribution metadata', () => {
  const storedValues = new Map<string, string>();
  const storage = {
    getItem: (key: string) => storedValues.get(key) ?? null,
    setItem: (key: string, value: string) => storedValues.set(key, value),
    removeItem: (key: string) => storedValues.delete(key),
    clear: () => storedValues.clear(),
  };
  const beacons = vi.fn((..._args: unknown[]) => true);

  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'event-1' });
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    vi.stubGlobal('navigator', { sendBeacon: beacons });
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
    storage.setItem('vozzify:visitor-id', 'visitor-1');
    beacons.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    storage.clear();
  });

  it('keeps an impression retry-identifiable and grouped to its visit', async () => {
    const queue = new HomeImpressionQueue();
    const stop = startHomeTracking(
      [
        {
          version: 'feed-1',
          algorithmVersion: 2,
          locale: 'pt-BR',
          audience: 'personal',
          rows: [{ id: 'row-0', items: [{ id: 'track-1' }] }],
        },
      ],
      queue,
      new Set(),
      'visit-1',
    );
    queue.record({
      rowId: 'row-0',
      feedVersion: 'feed-1',
      algorithmVersion: 2,
      locale: 'pt-BR',
      audience: 'personal',
      visitId: 'visit-1',
      eventId: 'event-1',
      items: [{ id: 'track-1', position: 0 }],
    });

    window.dispatchEvent(new Event('pagehide'));
    const [, payload] = beacons.mock.calls[0] as [string, Blob];
    expect(JSON.parse(await payload.text())).toMatchObject({
      visitorId: 'visitor-1',
      events: [
        {
          eventId: 'event-1',
          visitId: 'visit-1',
          locale: 'pt-BR',
          audience: 'personal',
          algorithmVersion: 2,
        },
      ],
    });
    stop();
  });

  it('uses the stable click id as the retry key for a click', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'click-1' });
    document.body.innerHTML =
      '<section data-home-row-id="row-0">' +
      '<a href="/pt-BR/tracks/track-1" data-home-item-id="track-1" ' +
      'data-home-item-position="0">track</a></section>';
    const stop = startHomeTracking(
      [
        {
          version: 'feed-1',
          algorithmVersion: 2,
          locale: 'pt-BR',
          audience: 'personal',
          rows: [{ id: 'row-0', items: [{ id: 'track-1' }] }],
        },
      ],
      new HomeImpressionQueue(),
      new Set(),
      'visit-1',
    );
    document
      .querySelector('a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const [, payload] = beacons.mock.calls[0] as [string, Blob];
    expect(JSON.parse(await payload.text())).toMatchObject({
      events: [
        {
          eventId: 'click-1',
          clickId: 'click-1',
          visitId: 'visit-1',
          locale: 'pt-BR',
          audience: 'personal',
        },
      ],
    });
    stop();
  });
});
