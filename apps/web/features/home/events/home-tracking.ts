import type { HomeEvent } from '@vozzify/contracts';
import { getClientEnv } from '@/lib/env/client';
import { withClickId } from '@/lib/home-click-id';
import { getOrCreateVisitorId } from '@/lib/visitor-id';
import {
  browserEventsTransport,
  buildClickEvent,
  sendEventsBatch,
} from './events-sender';
import { clickTargetOf } from './home-click';
import type { HomeImpressionQueue } from './impression-queue';
import { rowCardGeometries, visibleRowItems } from './row-visibility';
import {
  type HomeRowMeta,
  rowMetaOf,
  type TrackedHomePage,
} from './tracked-rows';

/** A row is reported once it is at least half visible... */
const IMPRESSION_VISIBLE_RATIO = 0.5;
/** ...for at least one second. */
const IMPRESSION_VISIBLE_MS = 1000;
/** Waiting impressions leave every few seconds, or when the page hides. */
const FLUSH_INTERVAL_MS = 5000;

const rowSelector = (rowId: string): string =>
  `[data-home-row-id="${CSS.escape(rowId)}"]`;

const readVisitorId = (): string | undefined => {
  try {
    return getOrCreateVisitorId(window.localStorage);
  } catch {
    return undefined;
  }
};

/** Records the row's impression with the items on screen, once per row. */
const recordRowImpression = (
  target: Element,
  rowId: string,
  meta: Map<string, HomeRowMeta>,
  queue: HomeImpressionQueue,
): void => {
  const row = meta.get(rowId);
  if (row === undefined) return;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const items = visibleRowItems(
    rowCardGeometries(target as HTMLElement),
    viewport,
  ).filter((item) => item.id !== '');
  if (items.length === 0) return;
  queue.record({
    ...row,
    rowId,
    items,
    ...(row.locale === undefined ? {} : { eventId: crypto.randomUUID() }),
  });
};

type VisibilityTracker = {
  observer: IntersectionObserver;
  timers: Map<string, ReturnType<typeof setTimeout>>;
};

/** Fires the row's impression a second after it shows, unless it hides first. */
const onRowVisibility = (
  entry: IntersectionObserverEntry,
  tracker: VisibilityTracker,
  meta: Map<string, HomeRowMeta>,
  queue: HomeImpressionQueue,
): void => {
  const rowId = (entry.target as HTMLElement).dataset.homeRowId ?? '';
  if (rowId === '') return;
  const timer = tracker.timers.get(rowId);
  if (entry.isIntersecting) {
    if (timer !== undefined) return;
    tracker.timers.set(
      rowId,
      setTimeout(() => {
        tracker.timers.delete(rowId);
        recordRowImpression(entry.target, rowId, meta, queue);
        tracker.observer.unobserve(entry.target);
      }, IMPRESSION_VISIBLE_MS),
    );
  } else if (timer !== undefined) {
    clearTimeout(timer);
    tracker.timers.delete(rowId);
  }
};

/** Watches every untracked row, once each. */
const trackRowImpressions = (
  meta: Map<string, HomeRowMeta>,
  queue: HomeImpressionQueue,
  tracked: Set<string>,
): (() => void) => {
  const tracker: VisibilityTracker = {
    observer: new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          onRowVisibility(entry, tracker, meta, queue);
        }
      },
      { threshold: IMPRESSION_VISIBLE_RATIO },
    ),
    timers: new Map(),
  };
  for (const rowId of meta.keys()) {
    if (tracked.has(rowId)) continue;
    const rowElement = document.querySelector(rowSelector(rowId));
    if (!rowElement) continue;
    tracked.add(rowId);
    tracker.observer.observe(rowElement);
  }
  return () => {
    tracker.observer.disconnect();
    for (const timer of tracker.timers.values()) clearTimeout(timer);
  };
};

/** Sends a click event per card click, never delaying the navigation. */
const trackCardClicks = (
  meta: Map<string, HomeRowMeta>,
  send: (events: HomeEvent[]) => void,
): (() => void) => {
  const recordClick = (event: MouseEvent): void => {
    const target = clickTargetOf(event.target, meta);
    const link = (event.target as Element | null)?.closest?.(
      'a[href]',
    ) as HTMLAnchorElement | null;
    if (target === undefined || link === null) return;
    const clickId = crypto.randomUUID();
    link.href = withClickId(link.href, clickId);
    send([
      buildClickEvent({
        ...target,
        clickId,
        ...(target.locale === undefined ? {} : { eventId: clickId }),
      }),
    ]);
  };
  const onClick = (event: MouseEvent): void => {
    if (event.button === 0) recordClick(event);
  };
  const onMiddleMouseDown = (event: MouseEvent): void => {
    if (event.button === 1) recordClick(event);
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('mousedown', onMiddleMouseDown, true);
  return () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousedown', onMiddleMouseDown, true);
  };
};

/** Flushes on an interval and when the page hides, and once more on cleanup. */
const trackPageHide = (flush: () => void): (() => void) => {
  const interval = setInterval(flush, FLUSH_INTERVAL_MS);
  const onHidden = (): void => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onHidden);
  return () => {
    clearInterval(interval);
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onHidden);
    flush();
  };
};

/**
 * Starts the page's home instrumentation: row impressions and card clicks of
 * `pages`, sent to `POST /v1/events` in batches. Answers the cleanup that
 * stops it. Does nothing without a visitor id.
 */
export function startHomeTracking(
  pages: TrackedHomePage[],
  queue: HomeImpressionQueue,
  tracked: Set<string>,
  visitId?: string,
): () => void {
  const visitorId = readVisitorId();
  if (visitorId === undefined) return () => undefined;
  const apiUrl = getClientEnv().NEXT_PUBLIC_API_URL;
  const meta = rowMetaOf(pages, visitId);
  const send = (events: HomeEvent[]): void => {
    if (events.length > 0) {
      sendEventsBatch(apiUrl, visitorId, events, browserEventsTransport());
    }
  };
  const flush = (): void => send(queue.takeBatch());
  const stopImpressions = trackRowImpressions(meta, queue, tracked);
  const stopClicks = trackCardClicks(meta, send);
  const stopHiding = trackPageHide(flush);
  return () => {
    stopImpressions();
    stopClicks();
    stopHiding();
  };
}
