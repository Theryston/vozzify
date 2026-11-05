import { CREPE_FRAME, CREPE_RATE, normalizeFrame } from './crepe';
import { Downsampler } from './downsampler';
import { pitchCandidates } from './pitch-candidates';
import { PitchTracker } from './pitch-tracker';
import { detectPitchYin, isSilent } from './yin';

/** What the ML engine needs from a model runtime: one frame in, one pitch out. */
export type ModelDetector = {
  /** Runs the model on a normalized 1024-sample, 16 kHz frame. */
  detect(frame: Float32Array): Promise<ArrayLike<number>>;
  /** Releases runtime resources once any active inference finishes. */
  dispose?(): Promise<void> | void;
};

/** New samples (at the model's rate) between two readings: 32 ms. */
const HOP = 512;

/**
 * Frames in a row that arrive while the model is still busy with the last one
 * before it is called too slow for real time (8 hops is a quarter second).
 */
export const MAX_DROPPED_FRAMES = 8;

export type ModelPipelineEvents = {
  onReading(midi: number | null, capturedAt?: number): void;
  /** The model can't be used any more: it failed or can't keep up. */
  onGiveUp(reason: 'failed' | 'too-slow'): void;
};

/**
 * The ML engine end to end: mic blocks go in, a smoothed reading comes out
 * per hop. Inference is asynchronous; a frame that arrives while the previous
 * one is still running is dropped, and too many drops in a row mean the device
 * can't keep up.
 */
export class ModelPipeline {
  readonly windowSeconds = CREPE_FRAME / CREPE_RATE;
  private readonly downsampler: Downsampler;
  private readonly window = new Float32Array(CREPE_FRAME);
  private readonly tracker = new PitchTracker();
  private sinceReading = 0;
  private elapsed = 0;
  private busy = false;
  private dropped = 0;
  private done = false;

  constructor(
    sampleRate: number,
    private readonly detector: ModelDetector,
    private readonly events: ModelPipelineEvents,
  ) {
    this.downsampler = new Downsampler(sampleRate, CREPE_RATE);
  }

  feed(block: Float32Array, capturedAt?: number): void {
    if (this.done) return;
    const samples = this.downsampler.push(block);
    if (samples.length === 0) return;
    // A block is far smaller than the window; keep only the newest samples.
    const keep = samples.subarray(Math.max(0, samples.length - CREPE_FRAME));
    this.window.copyWithin(0, keep.length);
    this.window.set(keep, CREPE_FRAME - keep.length);
    this.sinceReading += samples.length;
    this.elapsed += samples.length / CREPE_RATE;
    if (this.sinceReading >= HOP) {
      this.sinceReading %= HOP;
      this.read(capturedAt);
    }
  }

  stop(): void {
    if (this.done) return;
    this.done = true;
    // Cleanup is best-effort and must not become an unhandled rejection.
    void Promise.resolve(this.detector.dispose?.()).catch(() => {});
  }

  private read(capturedAt: number | undefined): void {
    if (this.busy) {
      this.dropped += 1;
      if (this.dropped >= MAX_DROPPED_FRAMES) this.giveUp('too-slow');
      return;
    }
    this.dropped = 0;
    const frame = this.window.slice();
    const time = this.elapsed - this.windowSeconds / 2;
    if (isSilent(frame)) {
      this.report({ activation: [], frame, time, capturedAt });
      return;
    }
    this.busy = true;
    this.detector.detect(normalizeFrame(frame)).then(
      (activation) => {
        this.busy = false;
        if (this.done) return;
        this.report({ activation, frame, time, capturedAt });
      },
      () => {
        this.busy = false;
        this.giveUp('failed');
      },
    );
  }

  private report({
    activation,
    frame,
    time,
    capturedAt,
  }: {
    activation: ArrayLike<number>;
    frame: Float32Array;
    time: number;
    capturedAt: number | undefined;
  }): void {
    const silent = isSilent(frame);
    this.events.onReading(
      this.tracker.push({
        candidates: pitchCandidates(activation),
        periodic: silent ? null : detectPitchYin(frame, CREPE_RATE),
        time,
        silent,
        frame,
      }),
      capturedAt,
    );
  }

  private giveUp(reason: 'failed' | 'too-slow'): void {
    if (this.done) return;
    this.stop();
    this.events.onGiveUp(reason);
  }
}
