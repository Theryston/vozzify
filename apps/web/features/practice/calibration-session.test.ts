import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeCalibrationReading } from './calibration-reading';
import { CALIBRATION_BEAT_MS, startCalibration } from './calibration-session';
import { createSingingSynth } from './singing-synth';

vi.mock('./singing-synth', () => ({ createSingingSynth: vi.fn() }));
const synth = { play: vi.fn(), dispose: vi.fn(), stop: vi.fn() };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  synth.play.mockImplementation(() => performance.now() / 1000);
  vi.mocked(createSingingSynth).mockResolvedValue(synth);
});
afterEach(() => {
  vi.useRealTimers();
});
describe('singing calibration', () => {
  it('runs a 3-beat count-in at the same tempo, then measures 10 sung attacks', async () => {
    let now = 0;
    const stepSeconds = CALIBRATION_BEAT_MS / 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now * 1000);
    const onCountIn = vi.fn();
    const onDone = vi.fn();
    const onBeat = vi.fn();
    const onCapture = vi.fn();
    const onVoice = vi.fn();
    const cancel = startCalibration({
      onCountIn,
      onDone,
      onBeat,
      onCapture,
      onVoice,
      onError: vi.fn(),
    });
    await Promise.resolve();
    for (let count = 0; count < 3; count++) {
      now = (count + 1) * stepSeconds;
      vi.advanceTimersByTime(CALIBRATION_BEAT_MS);
    }
    expect(onCountIn.mock.calls.map(([count]) => count)).toEqual([
      3,
      2,
      1,
      null,
    ]);
    for (let beat = 0; beat < 10; beat++) {
      const base = (beat + 3) * stepSeconds;
      now = base + 0.2;
      observeCalibrationReading(48, 0.05);
      now = base + 0.4;
      observeCalibrationReading(null, 0.05);
      now = base + stepSeconds;
      vi.advanceTimersByTime(CALIBRATION_BEAT_MS);
    }
    expect(onDone).toHaveBeenCalledWith(expect.closeTo(0.15));
    expect(onBeat.mock.calls.map(([count]) => count)).toEqual([
      10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
    expect(onCapture).toHaveBeenCalledTimes(10);
    expect(onVoice).toHaveBeenCalledWith(true);
    expect(onVoice).toHaveBeenCalledWith(false);
    expect(synth.dispose).toHaveBeenCalledOnce();
    cancel();
  });
  it('rejects silence instead of saving a guessed offset', async () => {
    const onDone = vi.fn();
    const cancel = startCalibration({
      onDone,
      onBeat: vi.fn(),
      onError: vi.fn(),
    });
    await Promise.resolve();
    vi.advanceTimersByTime(CALIBRATION_BEAT_MS * 13);
    expect(onDone).toHaveBeenCalledWith(null);
    cancel();
  });
  it('measures the residual against audible beeps, excluding Bluetooth output delay', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now * 1000);
    synth.play.mockImplementation(() => now + 0.2);
    const onDone = vi.fn();
    const cancel = startCalibration({
      onDone,
      onBeat: vi.fn(),
      onError: vi.fn(),
    });
    await Promise.resolve();
    for (let step = 1; step <= 13; step++) {
      now = (step * CALIBRATION_BEAT_MS) / 1000;
      vi.advanceTimersByTime(CALIBRATION_BEAT_MS);
      if (step < 3 || step === 13) continue;
      now += 0.2 + 0.05 + 0.032;
      observeCalibrationReading(69, 0.032);
      observeCalibrationReading(null, 0.032);
    }
    expect(onDone).toHaveBeenCalledWith(expect.closeTo(0.05, 6));
    cancel();
  });
  it('releases an in-progress session and ignores later readings', async () => {
    const onDone = vi.fn();
    const cancel = startCalibration({
      onDone,
      onBeat: vi.fn(),
      onError: vi.fn(),
    });
    await Promise.resolve();
    cancel();
    observeCalibrationReading(69, 0);
    vi.advanceTimersByTime(CALIBRATION_BEAT_MS * 14);
    expect(onDone).not.toHaveBeenCalled();
    expect(synth.dispose).toHaveBeenCalledOnce();
  });
  it('releases a synth that finishes loading after cancellation', async () => {
    const cancel = startCalibration({
      onDone: vi.fn(),
      onBeat: vi.fn(),
      onError: vi.fn(),
    });
    cancel();
    await Promise.resolve();
    expect(synth.play).not.toHaveBeenCalled();
    expect(synth.dispose).toHaveBeenCalledOnce();
  });
  it('reports unavailable audio without an unhandled rejection', async () => {
    vi.mocked(createSingingSynth).mockRejectedValue(new Error('blocked'));
    const onError = vi.fn();
    startCalibration({ onDone: vi.fn(), onBeat: vi.fn(), onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  });
});
