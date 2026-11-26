'use client';

import type { TrackAudio } from '@vozzify/contracts';
import { type RefObject, useEffect, useRef, useState } from 'react';

import type { PlaybackController } from '../playback/playback-controller';
import {
  type PlaybackSession,
  startPlayback,
} from '../playback/start-playback';
import { createPlayer } from '../player/create-player';
import { playbackStore } from '../stores/playback-store';
import { transposeStore } from '../stores/transpose-store';

type UsePlaybackOptions = {
  /** The element the video mounts into; set while the dock is on screen. */
  hostRef: RefObject<HTMLElement | null>;
  /** Null for a Track whose Processing chose no video: nothing plays. */
  videoId: string | null;
  /**
   * The Track's length until the player knows it. It may change while the page
   * is open (the notes arrive later), and that never rebuilds the player.
   */
  durationSeconds: number;
  fake: boolean;
  directAudio?: TrackAudio;
  onAudioFallback?: () => void;
};

const animationFrames = {
  request: (callback: () => void) => requestAnimationFrame(callback),
  cancel: (handle: number) => cancelAnimationFrame(handle),
};

/**
 * Wires `startPlayback` to the page: the session starts when the video's host
 * is on screen and stops when the video changes or the page leaves. Returns
 * null until the controller exists.
 */
export function usePlayback({
  hostRef,
  videoId,
  durationSeconds,
  fake,
  directAudio,
  onAudioFallback,
}: UsePlaybackOptions): PlaybackController | null {
  const [controller, setController] = useState<PlaybackController | null>(null);
  const session = useRef<PlaybackSession | null>(null);
  const durationRef = useRef(durationSeconds);
  durationRef.current = durationSeconds;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || videoId === null) return;
    session.current = startPlayback({
      host,
      videoId,
      fake,
      durationHint: durationRef.current,
      store: playbackStore,
      frames: animationFrames,
      makePlayer: (options) =>
        createPlayer({ ...options, directAudio, onAudioFallback }),
      onController: setController,
    });
    return () => {
      session.current?.dispose();
      session.current = null;
    };
  }, [hostRef, videoId, fake, directAudio, onAudioFallback]);

  useEffect(() => {
    if (!controller || !directAudio) return;
    controller.setTranspose(transposeStore.getState().semitones);
    return transposeStore.subscribe(({ semitones }) =>
      controller.setTranspose(semitones),
    );
  }, [controller, directAudio]);

  useEffect(() => {
    session.current?.setDurationHint(durationSeconds);
  }, [durationSeconds]);

  return controller;
}
