import type { TrackAudio } from '@vozzify/contracts';
import * as Tone from 'tone';

import { BasePlayer } from './base-player';
import type { PlayerPort } from './player-port';
import { compensatedPitch, waveformPeaks } from './waveform';

/** Native media seeks and streams; Tone applies transposition after rate correction. */
export class DirectAudioPlayer extends BasePlayer implements PlayerPort {
  private readonly audio = new Audio();
  // Tone's default standardized context does not expose native outputLatency.
  private readonly context = new Tone.Context({ context: new AudioContext() });
  private pitch: Tone.PitchShift | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private semitones = 0;
  private rate = 1;
  private pendingPosition: number | null = null;
  private pausedPosition: number | null = null;
  private presentationFloor = 0;
  private generation = 0;
  private disposed = false;
  private playingRequested = false;
  private cancelMediaLoad: (() => void) | null = null;
  private readonly downloads = new AbortController();
  private peaks: readonly number[] = [];

  constructor(private readonly urls: TrackAudio) {
    super();
    this.audio.crossOrigin = 'anonymous';
    this.audio.preservesPitch = false;
    this.audio.onended = () => {
      this.playingRequested = false;
      this.pausedPosition = this.audio.currentTime;
      this.presentationFloor = this.pausedPosition;
      this.emit('ended');
    };
    this.audio.onerror = () => this.emit('error');
  }

  async load(): Promise<void> {
    await this.switchSource(this.urls.musicMp3Url);
  }

  play(): void {
    if (!this.ready || this.disposed) return;
    this.playingRequested = true;
    const generation = this.generation;
    void this.context
      .resume()
      .then(async () => {
        if (!this.wantsPlayback(generation)) return false;
        this.connectGraph();
        await this.audio.play();
        return true;
      })
      .then((started) => {
        if (!started) return;
        if (this.disposed || !this.playingRequested) this.audio.pause();
        else if (generation === this.generation) this.emit('playing');
      })
      .catch(() => {
        if (this.wantsPlayback(generation)) this.emit('error');
      });
  }

  // PitchShift starts internal modulation sources. Construct them only after the
  // user gesture resumes the context, otherwise Tone warns about suspended audio.
  private connectGraph(): void {
    if (this.pitch) return;
    this.pitch = new Tone.PitchShift({
      context: this.context,
      wet: 0,
    }).toDestination();
    this.source = this.context.createMediaElementSource(this.audio);
    Tone.connect(this.source, this.pitch);
    this.updatePitch();
  }

  private updatePitch(): void {
    if (!this.pitch) return;
    const shift = compensatedPitch(this.semitones, this.rate);
    this.pitch.pitch = shift;
    // PitchShift still delays unison audio by half its window (50 ms by default).
    this.pitch.wet.setValueAtTime(
      shift === 0 ? 0 : 1,
      this.context.immediate(),
    );
  }

  private wantsPlayback(generation: number): boolean {
    return (
      !this.disposed && this.playingRequested && generation === this.generation
    );
  }

  pause(): void {
    this.pausedPosition = this.currentTime();
    this.presentationFloor = this.pausedPosition;
    this.playingRequested = false;
    this.audio.pause();
    this.emit('paused');
  }

  seek(seconds: number): void {
    this.pausedPosition = seconds;
    this.presentationFloor = seconds;
    if (!this.ready) this.pendingPosition = seconds;
    else this.audio.currentTime = seconds;
  }
  currentTime(): number {
    if (this.pendingPosition !== null || this.audio.paused)
      return (
        this.pausedPosition ?? this.pendingPosition ?? this.audio.currentTime
      );
    // Media routed through Web Audio reports the source head, before this
    // player's output buffers. The mic's separate context cannot measure them.
    return Math.max(
      this.presentationFloor,
      this.audio.currentTime - this.outputDelay() * this.rate,
    );
  }

  private outputDelay(): number {
    // The modulated delay lines vary around the center of the processing window.
    const processingDelay =
      this.pitch && this.pitch.pitch !== 0 ? this.pitch.windowSize / 2 : 0;
    const context = this.context.rawContext;
    if (!('baseLatency' in context)) return processingDelay;
    return [context.baseLatency, context.outputLatency].reduce(
      (total, delay) =>
        total + (Number.isFinite(delay) && delay > 0 ? delay : 0),
      processingDelay,
    );
  }
  duration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  }
  waveform(): readonly number[] {
    return this.peaks;
  }

  setRate(rate: number): void {
    this.presentationFloor = this.currentTime();
    this.rate = rate;
    this.audio.playbackRate = rate;
    this.updatePitch();
  }

  setTranspose(semitones: number): void {
    this.presentationFloor = this.currentTime();
    this.semitones = semitones;
    this.updatePitch();
  }

  setMuted(muted: boolean): void {
    this.audio.muted = muted;
  }

  setVocalsOnly(vocals: boolean): void {
    void this.switchSource(
      vocals ? this.urls.vocalsMp3Url : this.urls.musicMp3Url,
    ).catch(() => {
      if (!this.disposed) this.emit('error');
    });
  }

  destroy(): void {
    this.disposed = true;
    this.ready = false;
    this.generation++;
    this.cancelMediaLoad?.();
    this.downloads.abort();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.audio.onended = null;
    this.audio.onerror = null;
    this.source?.disconnect();
    this.pitch?.dispose();
    this.context.dispose();
    this.source = null;
    this.pitch = null;
    this.buffers.clear();
    this.clearListeners();
  }

  private async switchSource(url: string): Promise<void> {
    const generation = ++this.generation;
    this.cancelMediaLoad?.();
    this.pausedPosition = this.currentTime();
    this.presentationFloor = this.pausedPosition;
    this.pendingPosition ??= this.audio.currentTime;
    this.ready = false;
    this.audio.pause();
    const buffer = this.buffers.get(url) ?? (await this.decode(url));
    if (this.disposed || generation !== this.generation) return;
    this.buffers.set(url, buffer);
    this.peaks = waveformPeaks(buffer.getChannelData(0));
    await this.loadMedia(url);
    if (this.disposed || generation !== this.generation) return;
    this.audio.currentTime = Math.min(
      this.pendingPosition ?? 0,
      buffer.duration,
    );
    this.pendingPosition = null;
    this.setRate(this.rate);
    this.ready = true;
    this.emit('ready');
    if (this.playingRequested) this.play();
  }

  private async decode(url: string): Promise<AudioBuffer> {
    const response = await fetch(url, { signal: this.downloads.signal });
    if (!response.ok) throw new Error('Audio download failed');
    return this.context.decodeAudioData(await response.arrayBuffer());
  }

  private loadMedia(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const clear = () => {
        this.cancelMediaLoad = null;
        this.audio.onloadedmetadata = null;
        this.audio.onerror = () => this.emit('error');
      };
      this.cancelMediaLoad = () => {
        clear();
        resolve();
      };
      this.audio.onloadedmetadata = () => {
        clear();
        resolve();
      };
      this.audio.onerror = () => {
        clear();
        this.emit('error');
        reject(new Error('Audio load failed'));
      };
      this.audio.src = url;
      this.audio.load();
    });
  }
}
