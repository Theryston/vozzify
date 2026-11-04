// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { stopMic, toggleMic } from '../mic-controller';
import { initialMicState, micStore } from '../stores/mic-store';
import { voiceTrail } from '../voice-trail';
import { useScoring } from './use-scoring';

const capture = vi.hoisted(() => ({ stop: vi.fn() }));
vi.mock('../mic-session', () => ({
  startMicSession: () => Promise.resolve({ stop: capture.stop }),
}));

const notes = [{ pitch: 60, start: 0, end: 10 }];
let root: Root;
let scoring: ReturnType<typeof useScoring>;
const playback = createStore(() => ({ status: 'playing', time: 1 }));
const controls = {
  pause: vi.fn(() => playback.setState({ status: 'paused' })),
  play: vi.fn(),
  toggle: vi.fn(),
  seek: vi.fn(),
  subscribeSeek: () => () => {},
};

function Harness() {
  scoring = useScoring({ notes, playback, controls });
  return null;
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  micStore.setState(initialMicState);
  playback.setState({ status: 'playing', time: 1 });
  root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(createElement(Harness));
  });
  await act(async () => {
    await toggleMic(playback);
    voiceTrail.push(1, 60);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    stopMic();
  });
});

describe('microphone at the end of practice', () => {
  it('releases the capture and keeps the result when Stop is clicked', async () => {
    await act(async () => scoring.stop());
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(micStore.getState().status).toBe('off');
    expect(scoring.snapshot.result?.judged).toBe(1);
    expect(controls.pause).toHaveBeenCalledOnce();
  });

  it.each(['ended', 'error'])(
    'releases capture on playback %s',
    async (status) => {
      await act(async () => playback.setState({ status }));
      expect(capture.stop).toHaveBeenCalledOnce();
      expect(micStore.getState().status).toBe('off');
      expect(scoring.snapshot.result?.judged).toBe(1);
    },
  );

  it('keeps capture during a temporary pause and resumes the same run', async () => {
    await act(async () => playback.setState({ status: 'paused' }));
    expect(capture.stop).not.toHaveBeenCalled();
    expect(scoring.snapshot.result).toBeNull();
    await act(async () => playback.setState({ status: 'playing' }));
    expect(scoring.snapshot.summary.judged).toBe(1);
  });
});
