export type ByteRange = { start: number; end: number };

/** Accept one HTTP byte range so browser audio can seek without exposing S3. */
export function parsePrivateTrackByteRange(
  value: string | undefined,
  size: number,
): ByteRange | null | 'invalid' {
  if (value === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match) return 'invalid';
  const [, startText, endText] = match;
  if (!startText && !endText) return 'invalid';
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) {
      return 'invalid';
    }
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    };
  }
  const start = Number(startText);
  const end = endText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return 'invalid';
  }
  return { start, end: Math.min(end, size - 1) };
}
