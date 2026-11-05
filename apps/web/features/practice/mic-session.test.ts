import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startMicSession } from './mic-session';

const engine = vi.hoisted(() => ({
  feed: vi.fn(),
  stop: vi.fn(),
  options: undefined as
    | undefined
    | { onReading: (m: number | null, w: number, capturedAt?: number) => void },
}));

vi.mock('./pitch/crepe-model', () => ({ loadCrepeModel: vi.fn() }));
vi.mock('./pitch/pitch-engine', () => ({
  createPitchEngine: (options: typeof engine.options) => {
    engine.options = options;
    return { feed: engine.feed, stop: engine.stop };
  },
}));

type Fakes = {
  trackStop: ReturnType<typeof vi.fn>;
  contextClose: ReturnType<typeof vi.fn>;
  portClose: ReturnType<typeof vi.fn>;
  nodeDisconnect: ReturnType<typeof vi.fn>;
  sourceDisconnect: ReturnType<typeof vi.fn>;
  node: { port: { onmessage: ((event: unknown) => void) | null } } | null;
  timing: { currentTime: number; outputLatency: number; inputLatency: number };
};

/** The browser's audio objects, as far as the session uses them. */
function stubAudio(
  failAt?: 'worklet' | 'node' | 'source' | 'getUserMedia',
  constraints: { current?: MediaStreamConstraints } = {},
): Fakes {
  const fakes: Fakes = {
    trackStop: vi.fn(),
    contextClose: vi.fn(() => Promise.resolve()),
    portClose: vi.fn(),
    nodeDisconnect: vi.fn(),
    sourceDisconnect: vi.fn(),
    node: null,
    timing: { currentTime: 0, outputLatency: 0.02, inputLatency: 0.01 },
  };
  const track = {
    stop: fakes.trackStop,
    getSettings: () => ({ latency: fakes.timing.inputLatency }),
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: (requested: MediaStreamConstraints) => {
        constraints.current = requested;
        return failAt === 'getUserMedia'
          ? Promise.reject(new Error('denied'))
          : Promise.resolve(stream);
      },
    },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      sampleRate = 48_000;
      baseLatency = 0.01;
      get currentTime() {
        return fakes.timing.currentTime;
      }
      get outputLatency() {
        return fakes.timing.outputLatency;
      }
      audioWorklet = {
        addModule: () =>
          failAt === 'worklet'
            ? Promise.reject(new Error('no worklet'))
            : Promise.resolve(),
      };
      resume = () => Promise.resolve();
      close = fakes.contextClose;
      createMediaStreamSource() {
        if (failAt === 'source') throw new Error('no source');
        return { connect: vi.fn(), disconnect: fakes.sourceDisconnect };
      }
    },
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = { onmessage: null, close: fakes.portClose };
      disconnect = fakes.nodeDisconnect;
      constructor() {
        if (failAt === 'node') throw new Error('no node');
        fakes.node = this;
      }
    },
  );
  return fakes;
}

describe('startMicSession', () => {
  beforeEach(() => {
    engine.feed.mockReset();
    engine.stop.mockReset();
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('requests unprocessed singing audio, without speech filters or auto gain', async () => {
    const constraints: { current?: MediaStreamConstraints } = {};
    stubAudio(undefined, constraints);
    await startMicSession(vi.fn());
    expect(constraints.current).toEqual({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  });

  it('feeds the engine the worklet’s blocks and reports readings with the latency', async () => {
    const fakes = stubAudio();
    const onReading = vi.fn();
    await startMicSession(onReading);

    const block = new Float32Array(128);
    fakes.node?.port.onmessage?.({ data: { samples: block, capturedAt: 0 } });
    expect(engine.feed).toHaveBeenCalledWith(block, expect.any(Number));

    engine.options?.onReading(69, 0.04);
    // Only input 0.01 + half the 0.04 s window; output belongs to the player.
    expect(onReading).toHaveBeenCalledWith(69, expect.closeTo(0.03, 5));
  });

  it('does not move voice earlier when Bluetooth output latency grows', async () => {
    const fakes = stubAudio();
    const onReading = vi.fn();
    await startMicSession(onReading);
    for (const output of [0.02, 0.25]) {
      fakes.timing.outputLatency = output;
      engine.options?.onReading(69, 0.064);
    }
    expect(onReading.mock.calls).toEqual([
      [69, expect.closeTo(0.042)],
      [69, expect.closeTo(0.042)],
    ]);
  });

  it('includes queued worklet delivery and delayed inference without counting output latency', async () => {
    const fakes = stubAudio();
    const onReading = vi.fn();
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now * 1000);
    await startMicSession(onReading);
    fakes.timing.currentTime = 5.03;
    fakes.node?.port.onmessage?.({
      data: { samples: new Float32Array(128), capturedAt: 5 },
    });
    const capturedAt = engine.feed.mock.calls[0]?.[1];
    expect(capturedAt).toBeCloseTo(99.97);
    now += 0.05;
    engine.options?.onReading(69, 0.064, capturedAt);
    expect(onReading).toHaveBeenCalledWith(69, expect.closeTo(0.122));
  });

  it('releases everything when it is stopped, including the worklet port', async () => {
    const fakes = stubAudio();
    const session = await startMicSession(vi.fn());
    session.stop();
    expect(engine.stop).toHaveBeenCalledOnce();
    expect(fakes.portClose).toHaveBeenCalledOnce();
    expect(fakes.nodeDisconnect).toHaveBeenCalledOnce();
    expect(fakes.sourceDisconnect).toHaveBeenCalledOnce();
    expect(fakes.contextClose).toHaveBeenCalledOnce();
    expect(fakes.trackStop).toHaveBeenCalledOnce();
    expect(fakes.node?.port.onmessage).toBeNull();
  });

  it('releases only once when stopped twice', async () => {
    const fakes = stubAudio();
    const session = await startMicSession(vi.fn());
    session.stop();
    session.stop();
    expect(fakes.trackStop).toHaveBeenCalledOnce();
    expect(fakes.contextClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['the worklet fails to load', 'worklet'],
    ['the worklet node can’t be created', 'node'],
    ['the mic source can’t be created', 'source'],
  ] as const)(
    'releases the mic and the context when %s',
    async (_name, failAt) => {
      const fakes = stubAudio(failAt);
      await expect(startMicSession(vi.fn())).rejects.toThrow();
      expect(fakes.trackStop).toHaveBeenCalledOnce();
      expect(fakes.contextClose).toHaveBeenCalledOnce();
    },
  );

  it('does not touch the audio context when the mic is refused', async () => {
    const fakes = stubAudio('getUserMedia');
    await expect(startMicSession(vi.fn())).rejects.toThrow('denied');
    expect(fakes.contextClose).not.toHaveBeenCalled();
  });

  it('fails clearly when the browser has no getUserMedia', async () => {
    vi.stubGlobal('navigator', {});
    await expect(startMicSession(vi.fn())).rejects.toThrow('getUserMedia');
  });
});
