import type { TrackLyricLine } from '@vozzify/contracts';
import { describe, expect, it } from 'vitest';
import { karaokeSegments } from './karaoke-segments';
import { karaokeLineAt } from './lyrics-position';

const line: TrackLyricLine = {
  start: 1,
  end: 12,
  words: [
    { text: 'Pressure', start: 2, end: 3 },
    { text: 'pushing', start: 3, end: 4 },
    { text: 'down', start: 6, end: 7 },
    { text: 'on', start: 8, end: 9 },
    { text: 'me', start: 9, end: 10 },
  ],
};
const measure = (text: string) => text.length * 10;
const textOf = (item: TrackLyricLine | undefined) =>
  item?.words.map((word) => word.text).join(' ');

describe('karaoke segments', () => {
  it('fits each segment to the slot without losing or retiming words', () => {
    const segments = karaokeSegments([line], 160, measure);
    expect(segments.map(textOf)).toEqual(['Pressure pushing', 'down on me']);
    expect(segments.flatMap((item) => item.words)).toEqual(line.words);
    expect(segments.every((item) => measure(textOf(item) ?? '') <= 160)).toBe(
      true,
    );
    expect(line.words).toHaveLength(5);
  });

  it('switches at the continuation word and holds the final segment', () => {
    const segments = karaokeSegments([line], 160, measure);
    expect(textOf(segments[karaokeLineAt(segments, 0)])).toBe(
      'Pressure pushing',
    );
    expect(textOf(segments[karaokeLineAt(segments, 5)])).toBe(
      'Pressure pushing',
    );
    expect(textOf(segments[karaokeLineAt(segments, 6)])).toBe('down on me');
    expect(textOf(segments[karaokeLineAt(segments, 13)])).toBe('down on me');
    expect(karaokeLineAt(segments, 14.1)).toBe(-1);
  });

  it('leaves short, empty and not-yet-measured lines intact', () => {
    expect(karaokeSegments([line], 0, measure)).toEqual([line]);
    expect(karaokeSegments([line], 1_000, measure)).toEqual([line]);
    expect(karaokeSegments([], 100, measure)).toEqual([]);
    const empty = { start: 1, end: 2, words: [] };
    expect(karaokeSegments([empty], 100, measure)).toEqual([empty]);
  });

  it('keeps an oversized word whole and splits surrounding words', () => {
    expect(karaokeSegments([line], 40, measure).map(textOf)).toEqual([
      'Pressure',
      'pushing',
      'down',
      'on',
      'me',
    ]);
  });
});
