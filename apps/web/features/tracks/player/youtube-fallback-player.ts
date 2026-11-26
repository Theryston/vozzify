import { BasePlayer } from './base-player';
import { DEFAULT_RATE, type PlayerPort, type PlayerState } from './player-port';

const VIDEO_READY_TIMEOUT_MS = 15_000;
const EMPTY_WAVEFORM: readonly number[] = [];

type Sources = {
  createVideo: () => Promise<PlayerPort>;
  createAudio: () => Promise<PlayerPort>;
  onFallback: () => void;
};

/**
 * Owns both playback sources behind one controller. Failure switches to the
 * exact video's saved audio without resetting the practice clock or controls.
 */
export class YouTubeFallbackPlayer extends BasePlayer implements PlayerPort {
  private player: PlayerPort | undefined;
  private stopListening: (() => void) | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private startup:
    | { resolve: () => void; reject: (reason: unknown) => void }
    | undefined;
  private disposed = false;
  private usingAudio = false;
  private playingRequested = false;
  private failed = false;
  private position = 0;
  private rate = DEFAULT_RATE;
  private muted = false;
  private semitones = 0;

  constructor(private readonly sources: Sources) {
    super();
  }

  load(videoId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.startup = { resolve, reject };
      this.timeout = setTimeout(
        () => this.switchToAudio(videoId),
        VIDEO_READY_TIMEOUT_MS,
      );
      void this.openPlayer(videoId, false).catch(() =>
        this.switchToAudio(videoId),
      );
    });
  }

  play(): void {
    this.playingRequested = true;
    this.player?.play();
  }

  pause(): void {
    this.playingRequested = false;
    this.player?.pause();
  }

  seek(seconds: number): void {
    this.position = seconds;
    this.player?.seek(seconds);
  }

  currentTime(): number {
    const reported = this.player?.currentTime();
    if (reported !== undefined && Number.isFinite(reported)) {
      this.position = reported;
    }
    return this.position;
  }

  duration(): number {
    return this.player?.duration() ?? 0;
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.player?.setRate(rate);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.player?.setMuted(muted);
  }

  setTranspose(semitones: number): void {
    this.semitones = semitones;
    this.player?.setTranspose?.(semitones);
  }

  setVocalsOnly(vocals: boolean): void {
    this.player?.setVocalsOnly?.(vocals);
  }

  waveform(): readonly number[] {
    return this.player?.waveform?.() ?? EMPTY_WAVEFORM;
  }

  destroy(): void {
    this.disposed = true;
    this.ready = false;
    clearTimeout(this.timeout);
    this.startup?.resolve();
    this.startup = undefined;
    this.destroyCurrentPlayer();
    this.clearListeners();
  }

  private async openPlayer(videoId: string, audio: boolean): Promise<void> {
    const player = await (audio
      ? this.sources.createAudio()
      : this.sources.createVideo());
    if (this.disposed || this.usingAudio !== audio) {
      player.destroy();
      return;
    }
    this.player = player;
    player.setRate(this.rate);
    player.setMuted(this.muted);
    player.setTranspose?.(this.semitones);
    if (this.position > 0) player.seek(this.position);
    this.stopListening = player.onState((state) =>
      this.onPlayerState(videoId, state),
    );
    await player.load(videoId);
  }

  private onPlayerState(videoId: string, state: PlayerState): void {
    if (state === 'error') {
      if (this.usingAudio) this.fail(new Error('Saved audio could not play'));
      else this.switchToAudio(videoId);
      return;
    }
    if (state === 'ready') {
      const resume = !this.ready && this.playingRequested;
      this.ready = true;
      clearTimeout(this.timeout);
      this.startup?.resolve();
      this.startup = undefined;
      this.emit(state);
      if (resume) this.player?.play();
      return;
    }
    if (state === 'ended') this.playingRequested = false;
    this.emit(state);
  }

  private switchToAudio(videoId: string): void {
    if (this.disposed || this.usingAudio) return;
    clearTimeout(this.timeout);
    this.usingAudio = true;
    this.ready = false;
    // The last presented time stays reliable even if an errored iframe resets its clock.
    this.destroyCurrentPlayer();
    this.sources.onFallback();
    this.emit('loading');
    void this.openPlayer(videoId, true).catch((error: unknown) =>
      this.fail(error),
    );
  }

  private fail(error: unknown): void {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.ready = false;
    this.startup?.reject(error);
    this.startup = undefined;
    this.destroyCurrentPlayer();
    this.emit('error');
  }

  private destroyCurrentPlayer(): void {
    this.stopListening?.();
    this.stopListening = undefined;
    this.player?.destroy();
    this.player = undefined;
  }
}
