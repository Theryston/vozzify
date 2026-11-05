/** Loaded only for a guide melody or a calibration started by the User. */
export async function createSingingSynth() {
  const Tone = await import('tone');
  await Tone.start();
  const synth = new Tone.Synth({
    volume: -14,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.008, decay: 0.03, sustain: 0.6, release: 0.04 },
  }).toDestination();
  return {
    play(midi: number, seconds: number) {
      const scheduledAt = Tone.immediate();
      synth.triggerAttackRelease(
        440 * 2 ** ((midi - 69) / 12),
        Math.max(0.01, seconds),
        scheduledAt,
      );
      return audibleTime(Tone.getContext().rawContext, scheduledAt);
    },
    stop() {
      synth.triggerRelease(Tone.immediate());
    },
    dispose() {
      synth.dispose();
    },
  };
}

/** Resume the shared audio context during a playback gesture after a reload. */
export async function resumeSingingAudio(): Promise<void> {
  const Tone = await import('tone');
  await Tone.start();
}
/** Map the synth's render clock to when the output reaches the listener. */
function audibleTime(
  context: AudioContext | OfflineAudioContext,
  scheduledAt: number,
): number {
  if (!('baseLatency' in context)) return performance.now() / 1000;
  const timestamp = context.getOutputTimestamp?.();
  if (
    timestamp?.performanceTime !== undefined &&
    timestamp.performanceTime > 0 &&
    timestamp.contextTime !== undefined
  )
    return (
      timestamp.performanceTime / 1000 + scheduledAt - timestamp.contextTime
    );
  const delay = context.baseLatency + (context.outputLatency ?? 0);
  return (
    performance.now() / 1000 + (Number.isFinite(delay) ? Math.max(0, delay) : 0)
  );
}
