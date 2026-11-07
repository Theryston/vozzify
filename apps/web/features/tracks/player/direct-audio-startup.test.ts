import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ordering = vi.hoisted(() => [] as string[]);
vi.mock('tone', async () => {
  const { toneModule } = await import('../../../e2e/direct-audio-fixture');
  return {
    ...toneModule,
    PitchShift: class extends toneModule.PitchShift {
      constructor() {
        super();
        ordering.push('graph');
      }
    },
  };
});

import {
  Media,
  NativeAudioContext,
  settle,
  tone,
  urls,
} from '../../../e2e/direct-audio-fixture';
import { DirectAudioPlayer } from './direct-audio-player';

describe('direct audio startup ordering', () => {
  let player: DirectAudioPlayer;
  let media: Media;
  let resume: () => void;

  beforeEach(() => {
    vi.stubGlobal('AudioContext', NativeAudioContext);
    ordering.length = 0;
    tone.decode.mockResolvedValue({
      duration: 120,
      getChannelData: () => new Float32Array([1]),
    });
    tone.start.mockImplementation(() => {
      ordering.push('resume requested');
      return new Promise<void>((resolve) => {
        resume = () => {
          ordering.push('resumed');
          resolve();
        };
      });
    });
    vi.stubGlobal(
      'Audio',
      class extends Media {
        constructor() {
          super();
          media = this;
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
  });
  afterEach(() => {
    player.destroy();
  });

  it('decodes the waveform before play and creates modulation sources only after the context resumes', async () => {
    await player.load();
    player.setTranspose(3);
    player.setRate(0.5);
    expect(player.waveform()).toEqual([1]);
    expect(ordering).toEqual([]);
    player.play();
    expect(ordering).toEqual(['resume requested']);
    expect(media.play).not.toHaveBeenCalled();
    resume();
    await settle();
    expect(ordering).toEqual(['resume requested', 'resumed', 'graph']);
    expect(media.play).toHaveBeenCalledOnce();
    expect(tone.effect.pitch).toBe(15);
    player.pause();
    player.play();
    resume();
    await settle();
    expect(ordering.filter((event) => event === 'graph')).toHaveLength(1);
  });

  it('does not allocate an audio graph if disposed while context resume is pending', async () => {
    await player.load();
    player.play();
    player.destroy();
    resume();
    await settle();
    expect(ordering).toEqual(['resume requested', 'resumed']);
    expect(media.play).not.toHaveBeenCalled();
  });
});
