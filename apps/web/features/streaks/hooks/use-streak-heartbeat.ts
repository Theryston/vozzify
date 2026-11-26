'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StreakStatus } from '@vozzify/contracts';
import { useEffect, useRef } from 'react';

import { getClientEnv } from '@/lib/env/client';

import { heartbeatBeacon } from '../heartbeat-beacon';
import { type HeartbeatLoop, startHeartbeatLoop } from '../heartbeat-loop';
import { streakKeys } from '../query-keys';
import { browserTimeZone, sendHeartbeat } from '../streak-queries';

type HeartbeatAttribution = {
  viewId?: () => string | undefined;
  privateTrackId?: string;
};

/**
 * Reports practice time while the User is `singing` (the mic is on and a voice
 * is heard), writes each answer into the streak status the ring shows, and
 * calls `onCompleted` once on the heartbeat that reached the daily target.
 * Playback alone reports nothing. The heartbeat is a mutation (its answer
 * updates the status query); the pending seconds leave through a beacon when
 * the page is hidden or closed, which a mutation cannot do. The timing is in
 * `heartbeat-loop.ts`.
 */
export function useStreakHeartbeat(
  singing: boolean,
  onCompleted: (status: StreakStatus) => void,
  account?: string,
  attribution?: HeartbeatAttribution,
) {
  const queryClient = useQueryClient();
  const heartbeat = useMutation({
    mutationFn: sendHeartbeat,
    onSuccess: (result, body) => {
      queryClient.setQueryData(
        streakKeys.status(body.timeZone, account),
        result.status,
      );
    },
  });
  const send = useRef(heartbeat.mutateAsync);
  send.current = heartbeat.mutateAsync;
  const completed = useRef(onCompleted);
  completed.current = onCompleted;
  const singingRef = useRef(singing);
  singingRef.current = singing;
  const loop = useRef<HeartbeatLoop | null>(null);
  const viewIdRef = useRef(attribution?.viewId);
  viewIdRef.current = attribution?.viewId;
  const privateTrackId = attribution?.privateTrackId;

  useEffect(() => {
    let active = true;
    const started = startHeartbeatLoop({
      now: () => performance.now(),
      timeZone: browserTimeZone,
      viewId: () => viewIdRef.current?.(),
      privateTrackId,
      send: (body) => send.current(body),
      beacon: (body) => {
        const { url, data } = heartbeatBeacon(
          getClientEnv().NEXT_PUBLIC_API_URL,
          body,
        );
        navigator.sendBeacon(url, data);
      },
      onResult: (result) => {
        if (active && result.justCompleted) completed.current(result.status);
      },
    });
    started.setPlaying(singingRef.current);
    loop.current = started;

    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') started.flushWithBeacon();
    };
    const flush = () => started.flushWithBeacon();
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flush);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flush);
      // Leaving the practice page (not the browser) keeps what was played.
      started.flushWithBeacon();
      started.stop();
      loop.current = null;
    };
  }, [privateTrackId]);

  useEffect(() => {
    loop.current?.setPlaying(singing);
  }, [singing]);
}
