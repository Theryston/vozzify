import { describe, expect, it } from 'vitest';

import { latencyCompensation } from './latency';

describe('latencyCompensation', () => {
  it('adds only input latency and half the detector window', () => {
    expect(latencyCompensation({ inputLatency: 0.02 }, 0.04)).toBeCloseTo(0.04);
  });

  it('is just half the window when the browser reports nothing', () => {
    expect(latencyCompensation({}, 0.04)).toBeCloseTo(0.02);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores invalid reported input latency: %s',
    (inputLatency) => {
      expect(latencyCompensation({ inputLatency }, 0.04)).toBeCloseTo(0.02);
    },
  );

  it('grows with the reported input delay', () => {
    const base = latencyCompensation({ inputLatency: 0.05 }, 0.04);
    expect(latencyCompensation({ inputLatency: 0.15 }, 0.04)).toBeCloseTo(
      base + 0.1,
    );
  });

  it('includes time spent delivering and analyzing a captured frame', () => {
    expect(
      latencyCompensation({ inputLatency: 0.01 }, 0.064, 0.08),
    ).toBeCloseTo(0.122);
  });
});
