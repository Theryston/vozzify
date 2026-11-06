import type { HomeItemClickEvent, RecordEventsBody } from '@vozzify/contracts';

/** What a home click carries: the card, its row, and where it was shown. */
export type ClickTarget = Omit<HomeItemClickEvent, 'type'>;

/** The click event of a home card. Sent asynchronously, never awaited. */
export function buildClickEvent(target: ClickTarget): HomeItemClickEvent {
  return { type: 'home.item_click', ...target };
}

/**
 * How a batch leaves the browser: `sendBeacon` when it sticks (page hides,
 * navigations), a keepalive `fetch` otherwise. Both are fire-and-forget, so
 * the click's navigation is never delayed or blocked by the event.
 */
export type EventsTransport = {
  sendBeacon: ((url: string, data: BodyInit) => boolean) | undefined;
  fetchKeepalive: (url: string, body: RecordEventsBody) => void;
};

/** The browser's transport: beacon first, keepalive fetch as the fallback. */
export const browserEventsTransport = (): EventsTransport => ({
  sendBeacon:
    typeof navigator === 'undefined' ||
    typeof navigator.sendBeacon !== 'function'
      ? undefined
      : navigator.sendBeacon.bind(navigator),
  fetchKeepalive: (url, body) => {
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
  },
});

/** The ingestion endpoint of an API base URL (no trailing-slash surprises). */
export const eventsUrl = (apiUrl: string): string =>
  `${apiUrl.replace(/\/+$/, '')}/v1/events`;

/**
 * Sends the batch and returns at once: nothing is awaited, nothing can throw
 * to the caller, and an empty batch sends nothing. A failed beacon falls
 * back to the keepalive fetch; a failed fetch is swallowed, since events
 * must never break the page.
 */
export function sendEventsBatch(
  apiUrl: string,
  visitorId: string,
  events: RecordEventsBody['events'],
  transport: EventsTransport = browserEventsTransport(),
): void {
  if (events.length === 0) return;
  const body: RecordEventsBody = { visitorId, events };
  try {
    const payload = new Blob([JSON.stringify(body)], {
      type: 'application/json',
    });
    if (transport.sendBeacon?.(eventsUrl(apiUrl), payload)) return;
  } catch {
    // A throwing beacon still gets the fetch fallback below.
  }
  try {
    transport.fetchKeepalive(eventsUrl(apiUrl), body);
  } catch {
    // Events must never break the page.
  }
}
