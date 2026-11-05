import { expect, it, vi } from 'vitest';
import { createPitchEngine } from './pitch-engine';
import { activationFor } from './synthetic-activation';
import { syntheticTone } from './synthetic-tone';

it('preserves the capture time of a model frame while newer frames arrive', async () => {
  let answer: (activation: Float32Array) => void = () => {};
  const onReading = vi.fn();
  const detect = vi.fn(
    () =>
      new Promise<Float32Array>((resolve) => {
        answer = resolve;
      }),
  );
  const engine = createPitchEngine({
    sampleRate: 16000,
    loadModel: async () => ({ detect }),
    onReading,
    log: vi.fn(),
  });
  await Promise.resolve();
  const frame = syntheticTone({
    frequency: 440,
    sampleRate: 16000,
    length: 512,
  });
  engine.feed(frame, 10);
  engine.feed(frame, 10.032);
  expect(detect).toHaveBeenCalledOnce();
  answer(activationFor(440));
  await Promise.resolve();
  expect(onReading).toHaveBeenCalledOnce();
  expect(onReading.mock.calls[0]?.slice(1)).toEqual([0.064, 10]);
  engine.stop();
});

it('preserves capture time through the classic fallback', () => {
  const onReading = vi.fn();
  const engine = createPitchEngine({
    sampleRate: 16000,
    loadModel: () => new Promise(() => {}),
    onReading,
    log: vi.fn(),
  });
  engine.feed(new Float32Array(512), 20);
  expect(onReading).toHaveBeenCalledWith(null, 0.128, 20);
  engine.stop();
});
