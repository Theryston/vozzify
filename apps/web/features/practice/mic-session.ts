import { latencyCompensation } from './latency';
import { loadCrepeModel } from './pitch/crepe-model';
import { createPitchEngine } from './pitch/pitch-engine';

/** The audio thread's capture module; the bundler serves it as a file. */
const WORKLET_URL = new URL('./pitch/capture-worklet.js', import.meta.url);

/**
 * Speech processing can remove sustained vowels and reshape their harmonics.
 * Preserve the singing signal; headphones keep playback out of the mic.
 */
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};

function debugLog(message: string): void {
  // biome-ignore lint/suspicious/noConsole: which engine runs is meant to show in debug logs only.
  console.debug(`[pitch] ${message}`);
}

export type MicSession = { stop: () => void };

/** Gets a reading and how long before "now" on the Track it was sung. */
export type OnReading = (midi: number | null, lagSeconds: number) => void;

function createCaptureEngine(
  context: AudioContext,
  inputLatency: number | undefined,
  onReading: OnReading,
) {
  return createPitchEngine({
    sampleRate: context.sampleRate,
    loadModel: loadCrepeModel,
    onReading: (midi, windowSeconds, capturedAt) =>
      onReading(
        midi,
        latencyCompensation(
          { inputLatency },
          windowSeconds,
          capturedAt === undefined ? 0 : performance.now() / 1000 - capturedAt,
        ),
      ),
    log: debugLog,
  });
}

type CapturedAudio = { samples: Float32Array; capturedAt: number };

/** Wires the mic stream through the worklet into the pitch engine. */
async function connect(
  stream: MediaStream,
  onReading: OnReading,
  cleanups: (() => void)[],
): Promise<void> {
  const context = new AudioContext({ latencyHint: 'interactive' });
  cleanups.push(() => void context.close());
  await context.audioWorklet.addModule(WORKLET_URL);
  await context.resume();
  // `latency` is in the spec's track settings but not yet in TypeScript's DOM types.
  const settings: (MediaTrackSettings & { latency?: number }) | undefined =
    stream.getAudioTracks()[0]?.getSettings();
  const node = new AudioWorkletNode(context, 'pitch-capture');
  cleanups.push(() => {
    node.port.onmessage = null;
    node.port.close();
    node.disconnect();
  });
  const engine = createCaptureEngine(context, settings?.latency, onReading);
  cleanups.push(engine.stop);
  node.port.onmessage = ({ data }: MessageEvent<CapturedAudio>) => {
    // Both context times use the render clock, so queued delivery stays visible
    // without borrowing the unrelated output device's latency.
    const age = Math.max(0, context.currentTime - data.capturedAt);
    engine.feed(data.samples, performance.now() / 1000 - age);
  };
  const source = context.createMediaStreamSource(stream);
  cleanups.push(() => source.disconnect());
  source.connect(node);
}

/**
 * Opens the mic and reports the sung note as it changes. Pitch is found by
 * the CREPE model with the classic YIN detector as fallback
 * ({@link createPitchEngine}); the model and its runtime load here, so only
 * when the mic is turned on. Whatever fails after the mic was opened releases
 * everything that was acquired before throwing.
 */
export async function startMicSession(
  onReading: OnReading,
): Promise<MicSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia is not available');
  }
  const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  // Run newest first on release: the pipeline goes before the stream it reads.
  const cleanups: (() => void)[] = [
    () => {
      for (const track of stream.getTracks()) track.stop();
    },
  ];
  const release = () => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  };
  try {
    await connect(stream, onReading, cleanups);
  } catch (error) {
    release();
    throw error;
  }
  return { stop: release };
}
