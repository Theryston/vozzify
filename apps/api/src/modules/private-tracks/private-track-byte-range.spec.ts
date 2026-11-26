import { parsePrivateTrackByteRange } from './private-track-byte-range.js';

describe('parsePrivateTrackByteRange', () => {
  it('returns the full object when no range is requested', () => {
    expect(parsePrivateTrackByteRange(undefined, 100)).toBeNull();
  });

  it('parses bounded and open-ended ranges', () => {
    expect(parsePrivateTrackByteRange('bytes=10-19', 100)).toEqual({
      start: 10,
      end: 19,
    });
    expect(parsePrivateTrackByteRange('bytes=90-', 100)).toEqual({
      start: 90,
      end: 99,
    });
  });

  it('parses suffix ranges and caps the end at the object length', () => {
    expect(parsePrivateTrackByteRange('bytes=-10', 100)).toEqual({
      start: 90,
      end: 99,
    });
    expect(parsePrivateTrackByteRange('bytes=10-200', 100)).toEqual({
      start: 10,
      end: 99,
    });
  });

  it('rejects unsatisfiable or multiple ranges', () => {
    expect(parsePrivateTrackByteRange('bytes=100-', 100)).toBe('invalid');
    expect(parsePrivateTrackByteRange('bytes=20-10', 100)).toBe('invalid');
    expect(parsePrivateTrackByteRange('bytes=0-5,10-15', 100)).toBe('invalid');
  });
});
