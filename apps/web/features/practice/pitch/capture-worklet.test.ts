import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('timestamps the end of each captured block and copies its samples', () => {
  const postMessage = vi.fn();
  type Processor = { process(inputs: Float32Array[][]): boolean };
  let processor: Processor | undefined;
  const clock = {
    currentTime: 5,
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      port = { postMessage };
    },
    registerProcessor: (_name: string, Constructor: new () => Processor) => {
      processor = new Constructor();
    },
  };
  runInNewContext(
    readFileSync(new URL('./capture-worklet.js', import.meta.url), 'utf8'),
    clock,
  );
  const samples = new Float32Array(128).fill(0.25);
  expect(processor?.process([[samples]])).toBe(true);
  expect(postMessage).toHaveBeenCalledWith({
    samples,
    capturedAt: 5 + 128 / 48000,
  });
  expect(postMessage.mock.calls[0]?.[0].samples).not.toBe(samples);
  clock.currentTime = 6;
  processor?.process([[samples]]);
  expect(postMessage.mock.calls[1]?.[0].capturedAt).toBeCloseTo(
    6 + 128 / 48000,
  );
  postMessage.mockClear();
  expect(processor?.process([])).toBe(true);
  expect(postMessage).not.toHaveBeenCalled();
});
