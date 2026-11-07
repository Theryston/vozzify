import { vi } from 'vitest';

export const tone = {
  start: vi.fn().mockResolvedValue(undefined),
  connect: vi.fn(),
  disconnect: vi.fn(),
  dispose: vi.fn(),
  effect: {
    pitch: 0,
    windowSize: 0.1,
    wet: {
      value: 1,
      setValueAtTime: vi.fn((value: number): void => {
        tone.effect.wet.value = value;
      }),
    },
  },
  decode: vi.fn(),
  context: { baseLatency: 0, outputLatency: 0, currentTime: 0 },
};
export const toneModule = {
  start: tone.start,
  connect: tone.connect,
  immediate: () => tone.context.currentTime,
  PitchShift: class {
    constructor(options?: { wet: number }) {
      tone.effect.wet.value = options?.wet ?? 1;
    }
    toDestination() {
      return Object.assign(tone.effect, { dispose: tone.dispose });
    }
  },
  getContext: () => ({
    rawContext: tone.context,
    createMediaElementSource: () => ({ disconnect: tone.disconnect }),
    decodeAudioData: tone.decode,
  }),
};

export class Media {
  currentTime = 0;
  duration = 120;
  playbackRate = 1;
  muted = false;
  paused = true;
  src = '';
  crossOrigin = '';
  preservesPitch = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  removeAttribute = vi.fn(() => {
    this.src = '';
  });
  load = vi.fn(() => {
    if (this.src) queueMicrotask(() => this.onloadedmetadata?.());
  });
}

export const urls = {
  musicMp3Url: 'https://audio.example/music.mp3',
  vocalsMp3Url: 'https://audio.example/vocals.mp3',
};
export const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
