import type {
  StreakHeartbeatBody,
  StreakHeartbeatResult,
} from '@vozzify/contracts';

import { createPracticeMeter } from './practice-meter';

/** How often practice time is reported while the User is singing. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

export type HeartbeatLoopDeps = {
  /** A monotonic clock in milliseconds (`performance.now`). */
  now: () => number;
  timeZone: () => string;
  viewId?: () => string | undefined;
  privateTrackId?: string;
  /** Reports the time and answers with the status (`POST` heartbeat). */
  send: (body: StreakHeartbeatBody) => Promise<StreakHeartbeatResult>;
  /** Reports the time in a way that survives the page closing. */
  beacon: (body: StreakHeartbeatBody) => void;
  onResult: (result: StreakHeartbeatResult) => void;
};

export type HeartbeatLoop = {
  setPlaying: (playing: boolean) => void;
  /** Sends what is pending the page's way out: the page is hidden or closing. */
  flushWithBeacon: () => void;
  stop: () => void;
};

/**
 * Reports practice time: a heartbeat every 5 s while the User sings, and the
 * pending seconds through a beacon when the page is hidden or closed. A
 * heartbeat that fails is not retried: that stretch of practice goes
 * uncounted, which is cheaper than crediting it twice.
 */
export function startHeartbeatLoop(deps: HeartbeatLoopDeps): HeartbeatLoop {
  const meter = createPracticeMeter();

  const pending = (): StreakHeartbeatBody | null => {
    const elapsedSeconds = meter.take(deps.now());
    const viewId = deps.viewId?.();
    const { privateTrackId } = deps;
    return elapsedSeconds >= 1
      ? {
          elapsedSeconds,
          timeZone: deps.timeZone(),
          ...(privateTrackId === undefined ? {} : { privateTrackId }),
          ...(privateTrackId === undefined && viewId !== undefined
            ? { viewId }
            : {}),
        }
      : null;
  };

  const tick = async () => {
    const body = pending();
    if (body === null) return;
    try {
      deps.onResult(await deps.send(body));
    } catch {
      // See above: a lost heartbeat is dropped.
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, HEARTBEAT_INTERVAL_MS);

  return {
    setPlaying: (playing) => meter.setPlaying(playing, deps.now()),
    flushWithBeacon: () => {
      const body = pending();
      if (body !== null) deps.beacon(body);
    },
    stop: () => clearInterval(timer),
  };
}
