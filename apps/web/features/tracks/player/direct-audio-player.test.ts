import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  'tone',
  async () => (await import('../../../e2e/direct-audio-fixture')).toneModule,
);

import { Media, settle, tone, urls } from '../../../e2e/direct-audio-fixture';
import { DirectAudioPlayer } from './direct-audio-player';

describe('DirectAudioPlayer', () => {
  let audio: Media;
  let player: DirectAudioPlayer;
  const states = vi.fn();
  const fetchAudio = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    tone.context.baseLatency = 0;
    tone.context.outputLatency = 0;
    tone.context.currentTime = 0;
    tone.effect.windowSize = 0.1;
    tone.start.mockResolvedValue(undefined);
    audio = new Media();
    vi.stubGlobal(
      'Audio',
      class extends Media {
        constructor() {
          super();
          audio = this;
        }
      },
    );
    fetchAudio.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(2)),
    });
    vi.stubGlobal('fetch', fetchAudio);
    tone.decode.mockResolvedValue({
      duration: 120,
      getChannelData: () => new Float32Array([0, -0.5, 1]),
    });
    player = new DirectAudioPlayer(urls);
    player.onState(states);
  });
  afterEach(() => {
    player.destroy();
    vi.unstubAllGlobals();
  });

  it('decodes real amplitudes and announces readiness after media metadata', async () => {
    expect(player.isReady()).toBe(false);
    player.play();
    expect(tone.start).not.toHaveBeenCalled();
    await player.load();
    expect(player.isReady()).toBe(true);
    expect(player.duration()).toBe(120);
    expect(player.waveform()).toEqual([0, 0.5, 1]);
    expect(audio.src).toBe(urls.musicMp3Url);
    expect(audio.crossOrigin).toBe('anonymous');
    expect(audio.preservesPitch).toBe(false);
    expect(states).toHaveBeenLastCalledWith('ready');
  });

  it('plays, seeks, pauses, mutes and reports the end', async () => {
    await player.load();
    player.play();
    await settle();
    expect(states).toHaveBeenLastCalledWith('playing');
    player.seek(22);
    expect(player.currentTime()).toBe(22);
    player.setMuted(true);
    expect(audio.muted).toBe(true);
    player.pause();
    expect(states).toHaveBeenLastCalledWith('paused');
    audio.onended?.();
    expect(states).toHaveBeenLastCalledWith('ended');
    audio.duration = Number.NaN;
    expect(player.duration()).toBe(0);
  });

  it('compensates speed without changing the requested transposition', async () => {
    await player.load();
    player.play();
    await settle();
    player.setTranspose(4);
    expect(tone.effect.pitch).toBe(4);
    player.setRate(0.5);
    expect(audio.playbackRate).toBe(0.5);
    expect(tone.effect.pitch).toBe(16);
    player.setTranspose(-2);
    expect(tone.effect.pitch).toBe(10);
  });

  it('bypasses pitch processing at unison and restores it only when needed', async () => {
    await player.load();
    tone.context.currentTime = 37.5;
    player.play();
    await settle();
    expect(tone.effect.wet.value).toBe(0);
    expect(tone.effect.wet.setValueAtTime).toHaveBeenLastCalledWith(0, 37.5);
    player.setTranspose(4);
    expect(tone.effect.wet.value).toBe(1);
    player.setTranspose(0);
    expect(tone.effect.wet.value).toBe(0);
    player.setRate(0.5);
    expect(tone.effect.wet.value).toBe(1);
    player.setTranspose(-12);
    expect(tone.effect.pitch).toBe(0);
    expect(tone.effect.wet.value).toBe(0);
    player.setTranspose(0);
    expect(tone.effect.wet.value).toBe(1);
    player.setRate(1);
    expect(tone.effect.pitch).toBe(0);
    expect(tone.effect.wet.value).toBe(0);
  });

  it.each([0.5, 1, 1.5])(
    'reports audible Track time using its own output at %sx',
    async (rate) => {
      await player.load();
      player.setRate(rate);
      player.play();
      await settle();
      tone.context.baseLatency = 0.01;
      tone.context.outputLatency = 0.2;
      const outputDelay = rate === 1 ? 0.21 : 0.26;
      audio.currentTime = 10 + outputDelay * rate;
      expect(player.currentTime()).toBeCloseTo(10, 6);
      tone.context.outputLatency = 0.05;
      expect(player.currentTime()).toBeCloseTo(10 + 0.15 * rate, 6);
      audio.currentTime = 0;
      expect(player.currentTime()).toBe(0);
    },
  );

  it.each([-12, -7, -1, 1, 4, 7, 12])(
    'includes processing delay when transposed by %s semitones',
    async (semitones) => {
      await player.load();
      player.setTranspose(semitones);
      player.play();
      await settle();
      audio.currentTime = 10.05;
      expect(player.currentTime()).toBeCloseTo(10, 6);
      tone.effect.windowSize = 0.08;
      audio.currentTime = 10.04;
      expect(player.currentTime()).toBeCloseTo(10, 6);
    },
  );

  it('does not rewind presentation time when pitch processing is enabled', async () => {
    await player.load();
    player.play();
    await settle();
    audio.currentTime = 10;
    expect(player.currentTime()).toBe(10);
    player.setTranspose(4);
    expect(player.currentTime()).toBe(10);
    audio.currentTime = 10.1;
    expect(player.currentTime()).toBeCloseTo(10.05, 6);
    player.pause();
    expect(player.currentTime()).toBeCloseTo(10.05, 6);
    player.play();
    await settle();
    expect(player.currentTime()).toBeCloseTo(10.05, 6);
  });

  it('keeps the source position when switching audio with output compensation', async () => {
    await player.load();
    player.play();
    await settle();
    tone.context.outputLatency = 0.2;
    audio.currentTime = 32.2;
    player.setVocalsOnly(true);
    await settle();
    expect(audio.currentTime).toBeCloseTo(32.2);
    expect(player.currentTime()).toBeCloseTo(32);
  });

  it('keeps presentation time stable across pause, resume and seeks with Bluetooth delay', async () => {
    await player.load();
    tone.context.outputLatency = 0.3;
    player.play();
    await settle();
    audio.currentTime = 10.3;
    expect(player.currentTime()).toBeCloseTo(10);
    player.pause();
    expect(player.currentTime()).toBeCloseTo(10);
    player.play();
    await settle();
    expect(player.currentTime()).toBeCloseTo(10);
    player.seek(32);
    expect(player.currentTime()).toBeCloseTo(32);
    audio.currentTime = 32.15;
    expect(player.currentTime()).toBeCloseTo(32);
    audio.currentTime = 32.5;
    expect(player.currentTime()).toBeCloseTo(32.2);
    player.seek(5);
    expect(player.currentTime()).toBeCloseTo(5);
    player.pause();
    player.seek(20);
    expect(player.currentTime()).toBeCloseTo(20);
    player.play();
    await settle();
    expect(player.currentTime()).toBeCloseTo(20);
  });

  it('keeps the ended position when native media pauses and the source changes', async () => {
    await player.load();
    tone.context.outputLatency = 0.3;
    player.play();
    await settle();
    audio.currentTime = audio.duration;
    audio.paused = true;
    audio.onended?.();
    expect(player.currentTime()).toBe(120);
    player.setVocalsOnly(true);
    await settle();
    expect(player.currentTime()).toBe(120);
  });

  it('switches vocals in place, preserving time, rate and playback and caching decoded sources', async () => {
    await player.load();
    player.seek(32);
    player.setRate(0.75);
    player.play();
    await settle();
    player.setVocalsOnly(true);
    await settle();
    expect(audio.src).toBe(urls.vocalsMp3Url);
    expect(player.currentTime()).toBe(32);
    expect(audio.playbackRate).toBe(0.75);
    expect(states).toHaveBeenLastCalledWith('playing');
    player.pause();
    player.setVocalsOnly(false);
    await settle();
    expect(audio.src).toBe(urls.musicMp3Url);
    expect(audio.paused).toBe(true);
    expect(fetchAudio).toHaveBeenCalledTimes(2);
  });

  it('reports download and playback failures without unhandled rejections', async () => {
    fetchAudio.mockResolvedValueOnce({ ok: false });
    await expect(player.load()).rejects.toThrow('Audio download failed');
    await player.load();
    tone.start.mockRejectedValueOnce(new Error('blocked'));
    player.play();
    await settle();
    expect(states).toHaveBeenLastCalledWith('error');
    fetchAudio.mockRejectedValueOnce(new Error('offline'));
    player.setVocalsOnly(true);
    await settle();
    expect(states).toHaveBeenLastCalledWith('error');
  });

  it('ignores a decoded source that arrives after disposal', async () => {
    let finish: ((response: unknown) => void) | undefined;
    fetchAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const loading = player.load();
    player.destroy();
    finish?.({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    await loading;
    expect(audio.src).toBe('');
    expect(states).not.toHaveBeenCalled();
    expect(tone.disconnect).not.toHaveBeenCalled();
    expect(tone.dispose).not.toHaveBeenCalled();
  });
});
