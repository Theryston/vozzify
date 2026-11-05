import { beforeEach, expect, it, vi } from 'vitest';
import { createSingingSynth, resumeSingingAudio } from './singing-synth';

const audio = vi.hoisted(() => ({
  timestamp: { contextTime: 4, performanceTime: 100000 },
  start: vi.fn(),
  attack: vi.fn(),
  release: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('tone', () => ({
  start: audio.start,
  immediate: () => 4.25,
  getContext: () => ({
    rawContext: {
      baseLatency: 0.01,
      outputLatency: 0.2,
      getOutputTimestamp: () => audio.timestamp,
    },
  }),
  Synth: class {
    toDestination() {
      return this;
    }
    triggerAttackRelease = audio.attack;
    triggerRelease = audio.release;
    dispose = audio.dispose;
  },
}));
beforeEach(() => {
  audio.timestamp = { contextTime: 4, performanceTime: 100000 };
  vi.spyOn(performance, 'now').mockReturnValue(100000);
});

it('returns the audible onset rather than the synth scheduling time', async () => {
  const synth = await createSingingSynth();
  expect(synth.play(69, 0.25)).toBeCloseTo(100.25);
  expect(audio.attack).toHaveBeenCalledWith(440, 0.25, 4.25);
  synth.stop();
  expect(audio.release).toHaveBeenCalledWith(4.25);
  synth.dispose();
  expect(audio.dispose).toHaveBeenCalledOnce();
});

it('uses reported output delay while the output timestamp is not initialized', async () => {
  audio.timestamp = { contextTime: 0, performanceTime: 0 };
  const synth = await createSingingSynth();
  expect(synth.play(69, 0)).toBeCloseTo(100.21);
  expect(audio.attack).toHaveBeenCalledWith(440, 0.01, 4.25);
  synth.dispose();
});

it('resumes the audio context during a playback gesture', async () => {
  await resumeSingingAudio();
  expect(audio.start).toHaveBeenCalledOnce();
});
