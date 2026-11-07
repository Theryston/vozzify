import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  'tone',
  async () => (await import('../../../e2e/direct-audio-fixture')).toneModule,
);

import {
  Media,
  NativeAudioContext,
  settle,
  tone,
  urls,
} from '../../../e2e/direct-audio-fixture';
import { DirectAudioPlayer } from './direct-audio-player';

function pending<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe('direct audio async lifecycle', () => {
  let audio: Media;
  let player: DirectAudioPlayer;
  const states = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('AudioContext', NativeAudioContext);
    tone.start.mockResolvedValue(undefined);
    tone.decode.mockResolvedValue({
      duration: 120,
      getChannelData: () => new Float32Array([1]),
    });
    vi.stubGlobal(
      'Audio',
      class extends Media {
        constructor() {
          super();
          audio = this;
        }
      },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }),
    );
    player = new DirectAudioPlayer(urls);
    player.onState(states);
  });
  afterEach(() => {
    player.destroy();
  });

  it.each(['pause', 'destroy'] as const)(
    'does not start media after %s while the context is resuming',
    async (action) => {
      await player.load();
      const resume = pending<void>();
      tone.start.mockReturnValueOnce(resume.promise);
      player.play();
      player[action]();
      resume.resolve();
      await settle();
      expect(audio.play).not.toHaveBeenCalled();
      expect(states).not.toHaveBeenCalledWith('playing');
    },
  );

  it.each(['pause', 'destroy'] as const)(
    'pauses a late media play resolution after %s',
    async (action) => {
      await player.load();
      const playing = pending<void>();
      audio.play.mockImplementationOnce(() => playing.promise);
      player.play();
      await settle();
      player[action]();
      audio.paused = false;
      playing.resolve();
      await settle();
      expect(audio.paused).toBe(true);
      expect(states).not.toHaveBeenCalledWith('playing');
    },
  );

  it('settles pending metadata on destroy and removes its listeners', async () => {
    audio.load.mockImplementation(() => {});
    const loading = player.load();
    await settle();
    expect(audio.onloadedmetadata).not.toBeNull();
    player.destroy();
    await loading;
    expect(audio.onloadedmetadata).toBeNull();
    expect(audio.onerror).toBeNull();
    expect(player.isReady()).toBe(false);
  });

  it('settles superseded loads and preserves playing intent through rapid source changes', async () => {
    await player.load();
    player.play();
    await settle();
    audio.load.mockImplementation(() => {});
    player.setVocalsOnly(true);
    await settle();
    const replaced = audio.onloadedmetadata;
    expect(replaced).not.toBeNull();
    player.setVocalsOnly(false);
    await settle();
    audio.onloadedmetadata?.();
    await settle();
    expect(audio.src).toBe(urls.musicMp3Url);
    expect(audio.paused).toBe(false);
    expect(states).toHaveBeenLastCalledWith('playing');
  });
  it('retains seeks and speed changes made while a source is loading', async () => {
    await player.load();
    player.play();
    await settle();
    audio.load.mockImplementation(() => {});
    player.setVocalsOnly(true);
    await settle();
    player.seek(48);
    player.setRate(0.5);
    expect(player.currentTime()).toBe(48);
    audio.onloadedmetadata?.();
    await settle();
    expect(player.currentTime()).toBe(48);
    expect(audio.playbackRate).toBe(0.5);
    expect(tone.effect.pitch).toBe(12);
  });
});
