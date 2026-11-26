import { describe, expect, it, vi } from 'vitest';
import { FakePlayer } from './fake-player';
import type { PlayerState } from './player-port';
import { YouTubeFallbackPlayer } from './youtube-fallback-player';

function makePlayers() {
  const video = new FakePlayer({ durationSeconds: 90, now: () => 0 });
  const audio = new FakePlayer({ durationSeconds: 90, now: () => 0 });
  const createVideo = vi.fn(async () => video);
  const createAudio = vi.fn(async () => audio);
  const onFallback = vi.fn();
  const player = new YouTubeFallbackPlayer({
    createVideo,
    createAudio,
    onFallback,
  });
  const states: PlayerState[] = [];
  player.onState((state) => states.push(state));
  return { player, video, audio, createVideo, createAudio, onFallback, states };
}

describe('YouTube practice with saved audio fallback', () => {
  it('keeps the audio idle while the video plays, then resumes at the same position and settings', async () => {
    const { player, video, audio, states, createAudio, onFallback } =
      makePlayers();
    const mute = vi.spyOn(audio, 'setMuted');
    const rate = vi.spyOn(audio, 'setRate');
    const destroy = vi.spyOn(video, 'destroy');
    await player.load('submitted-id');
    player.seek(32);
    player.setRate(1.25);
    player.setMuted(true);
    player.play();
    expect(createAudio).not.toHaveBeenCalled();
    expect(player.currentTime()).toBe(32);

    video.fail();
    await vi.waitFor(() => expect(states.at(-1)).toBe('playing'));
    expect(states).toEqual(['ready', 'playing', 'loading', 'ready', 'playing']);
    expect(onFallback).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(player.currentTime()).toBe(32);
    expect(mute).toHaveBeenCalledWith(true);
    expect(rate).toHaveBeenCalledWith(1.25);
    player.destroy();
  });

  it('uses stored audio if the video API cannot load', async () => {
    const { player, createVideo, states, onFallback } = makePlayers();
    createVideo.mockRejectedValue(new Error('YouTube API unavailable'));
    await player.load('submitted-id');
    expect(onFallback).toHaveBeenCalledOnce();
    expect(states).toEqual(['loading', 'ready']);
    expect(player.isReady()).toBe(true);
    player.destroy();
  });

  it('uses stored audio if the IFrame API never becomes ready', async () => {
    vi.useFakeTimers();
    try {
      const { player, video, onFallback } = makePlayers();
      vi.spyOn(video, 'load').mockImplementation(() => new Promise(() => {}));
      const loaded = player.load('submitted-id');
      await vi.advanceTimersByTimeAsync(15_000);
      await loaded;
      expect(onFallback).toHaveBeenCalledOnce();
      expect(player.isReady()).toBe(true);
      player.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an error if saved audio is also unavailable', async () => {
    const { player, createVideo, createAudio, states } = makePlayers();
    createVideo.mockRejectedValue(new Error('video unavailable'));
    createAudio.mockRejectedValue(new Error('audio unavailable'));
    await expect(player.load('submitted-id')).rejects.toThrow(
      'audio unavailable',
    );
    expect(states).toEqual(['loading', 'error']);
    player.destroy();
  });

  it('honors a pause and a new seek while the saved audio is loading', async () => {
    const { player, video, audio, createAudio, states } = makePlayers();
    const pendingAudio = Promise.withResolvers<FakePlayer>();
    createAudio.mockReturnValueOnce(pendingAudio.promise);
    const shift = vi.fn();
    const setVocalsOnly = vi.fn();
    const peaks = [0.25, 0.75];
    const playAudio = vi.spyOn(audio, 'play');
    Object.assign(audio, {
      setTranspose: shift,
      setVocalsOnly,
      waveform: () => peaks,
    });

    await player.load('submitted-id');
    player.play();
    video.fail();
    player.seek(42);
    player.setTranspose(2);
    player.pause();
    expect(player.currentTime()).toBe(42);
    expect(player.waveform()).toEqual([]);
    pendingAudio.resolve(audio);
    await vi.waitFor(() => expect(states.at(-1)).toBe('ready'));

    expect(player.currentTime()).toBe(42);
    expect(player.duration()).toBe(90);
    expect(playAudio).not.toHaveBeenCalled();
    expect(shift).toHaveBeenCalledWith(2);
    player.setTranspose(3);
    expect(shift).toHaveBeenCalledWith(3);
    player.setVocalsOnly(true);
    expect(setVocalsOnly).toHaveBeenCalledWith(true);
    expect(player.waveform()).toBe(peaks);
    player.destroy();
  });

  it('reports a lost saved stream and disposes that source without starting YouTube again', async () => {
    const { player, video, audio, states, createVideo } = makePlayers();
    const destroy = vi.spyOn(audio, 'destroy');
    await player.load('submitted-id');
    video.fail();
    await vi.waitFor(() => expect(states.at(-1)).toBe('ready'));

    audio.fail();
    expect(states.at(-1)).toBe('error');
    expect(player.isReady()).toBe(false);
    expect(destroy).toHaveBeenCalledOnce();
    expect(createVideo).toHaveBeenCalledOnce();
    player.destroy();
  });

  it('keeps playback ended if the video fails after reaching the end', async () => {
    vi.useFakeTimers();
    try {
      const { player, video, audio, states } = makePlayers();
      const playAudio = vi.spyOn(audio, 'play');
      await player.load('submitted-id');
      player.play();
      await vi.advanceTimersByTimeAsync(90_000);
      expect(states.at(-1)).toBe('ended');
      expect(player.currentTime()).toBe(90);

      video.fail();
      await vi.advanceTimersByTimeAsync(0);
      expect(states.at(-1)).toBe('ended');
      expect(player.currentTime()).toBe(90);
      expect(playAudio).not.toHaveBeenCalled();
      player.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys a video that arrives after the practice page closes', async () => {
    const { player, video, onFallback } = makePlayers();
    const destroy = vi.spyOn(video, 'destroy');
    const loaded = player.load('submitted-id');
    player.destroy();
    await loaded;
    expect(destroy).toHaveBeenCalledOnce();
    expect(onFallback).not.toHaveBeenCalled();
  });
});
