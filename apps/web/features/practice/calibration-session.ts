import { calibrationOffset } from './calibration-math';
import { watchCalibrationReading } from './calibration-reading';
import { createSingingSynth } from './singing-synth';

export const CALIBRATION_BEAT_MS = 1250;
const COUNT_IN_BEATS = 3;

type Options = {
  onCountIn?: (count: number | null) => void;
  onBeat: (remaining: number) => void;
  onCapture?: (beat: number) => void;
  onVoice?: (singing: boolean) => void;
  onDone: (offset: number | null) => void;
  onError: () => void;
};

function isAttack(midi: number | null, previous: number | null): boolean {
  // Require a deliberate shift, rather than vibrato wobble.
  return midi !== null && (previous === null || Math.abs(midi - previous) >= 2);
}

const isAudibleBeat = (at: number, soundedAt: number): boolean =>
  at >= soundedAt && at - soundedAt < 1.05;

/**
 * Three count-in clicks followed by ten alternating beeps at the same tempo.
 * Timing calibration only needs the moment the voice attacks or shifts pitch
 * on the beat, not exact A4/C5 pitch matching.
 */
export function startCalibration(options: Options): () => void {
  let cancelled = false;
  let stop: () => void = () => {};
  void createSingingSynth()
    .then((synth) => {
      if (cancelled) {
        synth.dispose();
        return;
      }
      const samples: number[] = [];
      let step = -COUNT_IN_BEATS - 1;
      let soundedAt = 0;
      let captured = true;
      let previous: number | null = null;
      const unwatch = watchCalibrationReading(({ midi, lagSeconds, at }) => {
        options.onVoice?.(midi !== null);
        if (
          step >= 0 &&
          !captured &&
          isAttack(midi, previous) &&
          isAudibleBeat(at, soundedAt)
        ) {
          samples.push(at - soundedAt - lagSeconds);
          captured = true;
          options.onCapture?.(step);
        }
        previous = midi;
      });
      const next = () => {
        step += 1;
        if (step < 0) {
          synth.play(64, 0.08);
          options.onCountIn?.(-step);
          return;
        }
        if (step === 0) options.onCountIn?.(null);
        if (step === 10) {
          stop();
          options.onDone(calibrationOffset(samples));
          return;
        }
        captured = false;
        soundedAt = synth.play(step % 2 === 0 ? 69 : 72, 0.25);
        options.onBeat(10 - step);
      };
      const timer = setInterval(next, CALIBRATION_BEAT_MS);
      stop = () => {
        clearInterval(timer);
        unwatch();
        synth.dispose();
      };
      next();
    })
    .catch(() => {
      stop();
      if (!cancelled) options.onError();
    });
  return () => {
    cancelled = true;
    stop();
  };
}
