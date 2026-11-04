'use client';

import type { TrackNote } from '@vozzify/contracts';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { shiftedVoiceTime } from '../calibration-math';
import { type PlaybackSource, stopMic, toggleMic } from '../mic-controller';
import { ScoreSession } from '../score-session';
import { micStore } from '../stores/mic-store';
import { scoringSettings } from '../stores/scoring-settings';
import { singingAidsStore } from '../stores/singing-aids-store';
import { voiceTrail } from '../voice-trail';

type ScoringPlayback = Omit<PlaybackSource, 'getState'> & {
  getState(): { status: string; time: number; rate?: number };
};
export type ScoringControls = {
  pause(): void;
  seek(seconds: number): void;
  play(): void;
  toggle(): void;
  subscribeSeek(listener: (from: number, to: number) => void): () => void;
};
export type ScoringLoop = {
  getState(): { range: { start: number; end: number } | null };
  subscribe(listener: () => void): () => void;
};

type ScoringOptions = {
  notes: readonly TrackNote[];
  playback: ScoringPlayback;
  controls?: ScoringControls | null;
  loop?: ScoringLoop;
};

function connect(
  session: ScoreSession,
  { playback, controls, loop }: Omit<ScoringOptions, 'notes'>,
) {
  session.setSettings(scoringSettings.getState());
  session.setLoop(loop?.getState().range ?? null);
  const sync = () => {
    const status = playback.getState().status;
    const micOn = micStore.getState().status === 'on';
    session.synchronize(
      micOn && status === 'playing',
      !micOn || status === 'ended' || status === 'error',
    );
    if (
      (status === 'ended' || status === 'error') &&
      micStore.getState().status !== 'off'
    )
      stopMic();
  };
  sync();
  const stops = [
    playback.subscribe(sync),
    micStore.subscribe(sync),
    scoringSettings.subscribe((settings) => session.setSettings(settings)),
    voiceTrail.subscribe((reading) => {
      if (
        !reading ||
        playback.getState().status !== 'playing' ||
        micStore.getState().status !== 'on'
      )
        return;
      const { offset } = singingAidsStore.getState();
      session.record(
        shiftedVoiceTime(reading.time, offset, playback.getState().rate ?? 1),
        reading.midi,
      );
    }),
    controls?.subscribeSeek((from, to) => session.seek(from, to)),
    loop?.subscribe(() => session.setLoop(loop.getState().range)),
  ];
  return () => {
    for (const stop of stops) stop?.();
  };
}

async function restart(session: ScoreSession, options: ScoringOptions) {
  session.dismiss();
  options.controls?.seek(options.loop?.getState().range?.start ?? 0);
  if (micStore.getState().status === 'off') await toggleMic(options.playback);
  if (micStore.getState().status !== 'on') return;
  session.begin();
  if (options.playback.getState().status === 'playing')
    options.controls?.play();
  else options.controls?.toggle();
}

export function useScoring(options: ScoringOptions) {
  const { notes, playback, controls, loop } = options;
  const [session] = useState(() => new ScoreSession(notes));
  useEffect(() => session.updateTargets(notes), [session, notes]);
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(
    () => connect(session, { playback, controls, loop }),
    [session, playback, controls, loop],
  );
  return {
    session,
    snapshot,
    stop: () => {
      controls?.pause();
      session.finish();
      stopMic();
    },
    retry: () => {
      void restart(session, options);
    },
  };
}
