import { shiftedVoiceTime } from './calibration-math';
import { observeCalibrationReading } from './calibration-reading';
import { takeHeadphonesTip } from './headphones-tip';
import { micProblemOf } from './mic-problem';
import type { MicSession } from './mic-session';
import { isPageHidden, watchPageHidden } from './page-visibility';
import { micStore } from './stores/mic-store';
import { voiceTrail } from './voice-trail';

/** The part of the page's playback the voice is placed against. */
export type PlaybackSource = {
  getState(): { status: string; time: number; rate?: number };
  subscribe(listener: () => void): () => void;
};

let session: MicSession | null = null;
let stopWatching: (() => void) | null = null;
/** Bumped by every start and stop, so a start that finishes late knows it. */
let generation = 0;

/** Places a reading on the Track; while paused it only feeds the readout. */
function placeReading(playback: PlaybackSource) {
  return (midi: number | null, lagSeconds: number): void => {
    observeCalibrationReading(midi, lagSeconds);
    const { status, time, rate = 1 } = playback.getState();
    if (status === 'playing')
      voiceTrail.push(shiftedVoiceTime(time, lagSeconds, rate), midi);
    else voiceTrail.setLatest(midi);
  };
}

/**
 * Turns the mic on. The pitch engine is a dynamic import, so just listening
 * to a Track never downloads it. A refusal is left in the store for the dock
 * to explain; it is not thrown. If the mic is turned off (or the page left)
 * while it is still starting, the session that arrives late is stopped at once
 * instead of being left recording.
 */
async function startMic(playback: PlaybackSource): Promise<void> {
  if (micStore.getState().status !== 'off') return;
  const mine = ++generation;
  micStore.setState({ status: 'starting', notice: null });
  try {
    const { startMicSession } = await import('./mic-session');
    const started = await startMicSession(placeReading(playback));
    if (mine !== generation) {
      started.stop();
      return;
    }
    // The tab can be hidden while the browser asks for permission; a mic that
    // opens in a hidden tab would stay on with nobody looking.
    if (isPageHidden()) {
      started.stop();
      micStore.setState({ status: 'off', notice: null });
      return;
    }
    session = started;
    stopWatching = watchPageHidden(stopMic);
    micStore.setState({
      status: 'on',
      notice: takeHeadphonesTip() ? 'headphones' : null,
    });
  } catch (error) {
    if (mine !== generation) return;
    micStore.setState({ status: 'off', notice: micProblemOf(error) });
  }
}

/** Releases the mic and forgets the voice and any notice about it. */
export function stopMic(): void {
  generation += 1;
  session?.stop();
  session = null;
  stopWatching?.();
  stopWatching = null;
  voiceTrail.clear();
  micStore.setState({ status: 'off', notice: null });
}

export function dismissMicNotice(): void {
  micStore.setState({ notice: null });
}

export function toggleMic(playback: PlaybackSource): Promise<void> {
  if (micStore.getState().status === 'on') {
    stopMic();
    return Promise.resolve();
  }
  return startMic(playback);
}
