/** Capture latency only; the player's clock owns its output path. */
export type AudioLatencies = {
  /** The mic track's `latency` setting: from the voice to the samples. */
  inputLatency?: number;
};

const finite = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Age of a voice reading relative to the player's presentation clock.
 * Output latency from a separate mic context must not be subtracted from a
 * media player's time: that clock can already account for the output delay.
 * A reading describes the middle of its window, before delivery and inference.
 */
export function latencyCompensation(
  latencies: AudioLatencies,
  windowSeconds: number,
  processingSeconds = 0,
): number {
  return (
    finite(latencies.inputLatency) +
    windowSeconds / 2 +
    finite(processingSeconds)
  );
}
