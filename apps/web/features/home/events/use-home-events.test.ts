// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackedHomePage } from './tracked-rows';
import { useHomeEvents } from './use-home-events';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/env/client', () => ({
  getClientEnv: () => ({ NEXT_PUBLIC_API_URL: 'https://api.test' }),
}));

type ObserverCallback = (
  entries: {
    isIntersecting: boolean;
    target: Element;
  }[],
) => void;

const observers: MockIntersectionObserver[] = [];

class MockIntersectionObserver {
  readonly elements = new Set<Element>();
  disconnected = false;

  constructor(private readonly callback: ObserverCallback) {
    observers.push(this);
  }

  observe = vi.fn((target: Element) => {
    this.elements.add(target);
  });

  unobserve = vi.fn((target: Element) => {
    this.elements.delete(target);
  });

  disconnect = vi.fn(() => {
    this.disconnected = true;
  });

  emit(entries: { isIntersecting: boolean; target: Element }[]): void {
    this.callback(entries);
  }
}

vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

const fetchMock = vi.fn<typeof fetch>();
const sendBeaconMock = vi.fn<(...args: unknown[]) => boolean>();

const pages: TrackedHomePage[] = [
  {
    version: 'a1b2c3d4e5f60718',
    algorithmVersion: 1,
    locale: 'en',
    audience: 'public',
    rows: [
      { id: 'row-0', items: [{ id: 'track-1' }, { id: 'track-2' }] },
      { id: 'row-1', items: [{ id: 'track-3' }] },
    ],
  },
];

const rowMarkup = (rowId: string, cards: string): string =>
  `<section data-home-row-id="${rowId}">${cards}</section>`;

const cardMarkup = (id: string, position: number): string =>
  `<a href="/en/tracks/${id}" data-home-item-id="${id}" ` +
  `data-home-item-position="${position}">${id}</a>`;

function Harness({ tracked }: { tracked: TrackedHomePage[] }) {
  useHomeEvents(tracked);
  return null;
}

const onScreen = () => ({
  top: 100,
  bottom: 300,
  left: 16,
  right: 200,
  x: 16,
  y: 100,
  width: 184,
  height: 200,
  toJSON: () => ({}),
});

const storageOf = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
    removeItem: (key: string): void => {
      values.delete(key);
    },
    clear: (): void => {
      values.clear();
    },
    get length(): number {
      return values.size;
    },
    key: (index: number): string | null => [...values.keys()][index] ?? null,
  };
};

type MockStorage = ReturnType<typeof storageOf>;

describe('useHomeEvents', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let storage: MockStorage;

  const renderHarness = async (tracked: TrackedHomePage[] = pages) => {
    await act(async () => {
      root.render(createElement(Harness, { tracked }));
    });
  };

  const observeRow = (rowId: string) =>
    observers[0]?.elements.has(
      document.querySelector(`[data-home-row-id="${rowId}"]`) as Element,
    ) === true;

  beforeEach(() => {
    vi.useFakeTimers();
    // The config unstubs globals between tests, so the observer mock is
    // (re-)installed here, after that restore ran.
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    observers.length = 0;
    fetchMock.mockReset().mockResolvedValue(Response.json({}));
    sendBeaconMock.mockReset().mockReturnValue(true);
    Object.defineProperty(window.navigator, 'sendBeacon', {
      value: sendBeaconMock,
      configurable: true,
    });
    storage = storageOf();
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
    document.body.innerHTML =
      rowMarkup('row-0', cardMarkup('track-1', 0) + cardMarkup('track-2', 1)) +
      rowMarkup('row-1', cardMarkup('track-3', 0));
    for (const card of document.querySelectorAll('[data-home-item-id]')) {
      card.getBoundingClientRect = () => onScreen() as DOMRect;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  it('sends a row impression once the row is half visible for a second', async () => {
    await renderHarness();
    expect(observeRow('row-0')).toBe(true);

    const row = document.querySelector('[data-home-row-id="row-0"]') as Element;
    await act(async () => {
      observers[0]?.emit([{ isIntersecting: true, target: row }]);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendBeaconMock).toHaveBeenCalledTimes(1);
    const [url, payload] = sendBeaconMock.mock.calls[0] as [string, Blob];
    expect(url).toBe('https://api.test/v1/events');
    expect(JSON.parse(await payload.text())).toEqual({
      visitorId: expect.any(String),
      events: [
        {
          type: 'home.row_impression',
          eventId: expect.any(String),
          visitId: expect.any(String),
          locale: 'en',
          audience: 'public',
          rowId: 'row-0',
          feedVersion: 'a1b2c3d4e5f60718',
          algorithmVersion: 1,
          items: [
            { id: 'track-1', position: 0 },
            { id: 'track-2', position: 1 },
          ],
        },
      ],
    });
  });

  it('sends each row once per page load, no matter how often it shows', async () => {
    await renderHarness();
    const row = document.querySelector('[data-home-row-id="row-0"]') as Element;

    await act(async () => {
      observers[0]?.emit([{ isIntersecting: true, target: row }]);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await act(async () => {
      observers[0]?.emit([{ isIntersecting: true, target: row }]);
    });
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    expect(sendBeaconMock).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the row hides before the second passes', async () => {
    await renderHarness();
    const row = document.querySelector('[data-home-row-id="row-0"]') as Element;

    await act(async () => {
      observers[0]?.emit([{ isIntersecting: true, target: row }]);
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await act(async () => {
      observers[0]?.emit([{ isIntersecting: false, target: row }]);
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(sendBeaconMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flushes waiting impressions when the page hides', async () => {
    await renderHarness();
    const row = document.querySelector('[data-home-row-id="row-0"]') as Element;
    await act(async () => {
      observers[0]?.emit([{ isIntersecting: true, target: row }]);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(sendBeaconMock).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(sendBeaconMock).toHaveBeenCalledTimes(1);
  });

  it('sends a click asynchronously, without delaying or blocking navigation', async () => {
    await renderHarness();
    const link = document.querySelector(
      '[data-home-item-id="track-2"]',
    ) as HTMLAnchorElement;

    let defaultPrevented: boolean | undefined;
    await act(async () => {
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(event);
      defaultPrevented = event.defaultPrevented;
    });

    expect(defaultPrevented).toBe(false);
    expect(sendBeaconMock).toHaveBeenCalledTimes(1);
    const [, payload] = sendBeaconMock.mock.calls[0] as [string, Blob];
    expect(JSON.parse(await payload.text())).toEqual({
      visitorId: expect.any(String),
      events: [
        {
          type: 'home.item_click',
          eventId: expect.any(String),
          visitId: expect.any(String),
          locale: 'en',
          audience: 'public',
          clickId: expect.any(String),
          rowId: 'row-0',
          feedVersion: 'a1b2c3d4e5f60718',
          algorithmVersion: 1,
          itemId: 'track-2',
          position: 1,
        },
      ],
    });
    const body = JSON.parse(await payload.text()) as {
      events: { clickId?: string; eventId?: string }[];
    };
    expect(body.events[0]?.eventId).toBe(body.events[0]?.clickId);
    expect(link.href).toContain('clickId=');
  });

  it('keeps the same visitor id across page loads', async () => {
    await renderHarness();
    const row = document.querySelector('[data-home-row-id="row-0"]') as Element;
    await act(async () => {
      observers[0]?.emit([{ isIntersecting: true, target: row }]);
    });
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    const first = sendBeaconMock.mock.calls[0] as [string, Blob];
    const firstVisitor = (
      JSON.parse(await first[1].text()) as {
        visitorId: string;
      }
    ).visitorId;
    expect(window.localStorage.getItem('vozzify:visitor-id')).toBe(
      firstVisitor,
    );
    sendBeaconMock.mockClear();

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await renderHarness();
    const other = document.querySelector(
      '[data-home-row-id="row-1"]',
    ) as Element;
    await act(async () => {
      observers[1]?.emit([{ isIntersecting: true, target: other }]);
    });
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    const second = sendBeaconMock.mock.calls[0] as [string, Blob];
    expect(
      (JSON.parse(await second[1].text()) as { visitorId: string }).visitorId,
    ).toBe(firstVisitor);
  });
});
