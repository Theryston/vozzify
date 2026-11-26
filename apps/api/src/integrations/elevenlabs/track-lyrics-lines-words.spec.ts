import { timedLyricsOf } from './track-lyrics-lines.js';

// The words-only line pipeline, one rule at a time plus the full pipeline on
// a realistic long word stream. Fixtures are synthetic; segments ride along
// only to prove they are ignored.

const word = (text: string, start: number, end: number, speaker?: string) => ({
  word: text,
  start,
  end,
  ...(speaker === undefined ? {} : { speaker }),
});

const GIANT_SEGMENT = [{ start: 0, end: 80 }];

const textsOf = (lines: { words: { text: string }[] }[]) =>
  lines.map((line) => line.words.map((item) => item.text));

const lineText = (line: { words: { text: string }[] }) =>
  line.words.map((item) => item.text).join(' ');

describe('timedLyricsOf words-only pipeline', () => {
  it('ignores provider segments: the same words make the same lines', () => {
    const words = [
      word('Is', 0.1, 0.4),
      word('this', 0.5, 0.9),
      word('the', 2.5, 2.8),
      word('real', 2.9, 3.4),
    ];
    const giant = timedLyricsOf({ segments: GIANT_SEGMENT, words });
    const none = timedLyricsOf({ segments: [], words });
    const split = timedLyricsOf({
      segments: [
        { start: 0, end: 2 },
        { start: 2, end: 4 },
      ],
      words,
    });

    expect(giant).toEqual(none);
    expect(giant).toEqual(split);
    expect(textsOf(giant)).toEqual([
      ['Is', 'this'],
      ['the', 'real'],
    ]);
  });

  it('keeps the grouping of an already-short word stream', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [
        word('Is', 1.1, 1.3),
        word('this', 1.4, 1.8),
        word('the', 3.1, 3.3),
        word('real', 3.4, 3.8),
        word('life', 3.9, 4.3),
      ],
    });

    expect(textsOf(lines)).toEqual([
      ['Is', 'this'],
      ['the', 'real', 'life'],
    ]);
  });

  it('times every span from first-word start to last-word end', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [word('Is', 1.1, 1.3), word('this', 1.4, 1.8)],
    });

    expect(lines.map((line) => [line.start, line.end])).toEqual([[1.1, 1.8]]);
  });

  it('always breaks on a hard silence at or above 1.2s', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [word('hello', 0, 0.5), word('there', 1.7, 2.1)],
    });

    expect(textsOf(lines)).toEqual([['hello'], ['there']]);
  });

  it('keeps a short line together across a gap just under 1.2s', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [word('hello', 0, 0.5), word('there', 1.6, 2.0)],
    });

    expect(textsOf(lines)).toEqual([['hello', 'there']]);
  });

  it('breaks on a soft silence only with line body behind it', () => {
    const withBody = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [
        word('one', 0, 0.3),
        word('two', 0.4, 0.7),
        word('three', 0.8, 1.1),
        word('four', 1.2, 1.5),
        word('five', 1.6, 1.9),
        word('six', 2.7, 3.0),
      ],
    });
    const withoutBody = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [word('one', 0, 0.3), word('two', 1.1, 1.4)],
    });

    expect(textsOf(withBody)).toEqual([
      ['one', 'two', 'three', 'four', 'five'],
      ['six'],
    ]);
    expect(textsOf(withoutBody)).toEqual([['one', 'two']]);
  });

  it('always breaks after terminal punctuation', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [
        word('Is', 0, 0.3),
        word('this', 0.4, 0.7),
        word('the', 0.8, 1.1),
        word('real', 1.2, 1.5),
        word('life.', 1.6, 2.0),
        word('Oh', 2.2, 2.5),
        word('I', 2.6, 2.7),
        word('see', 2.8, 3.1),
        word('it.', 3.2, 3.6),
        word('Yeah', 3.8, 4.1),
        word('you', 4.2, 4.4),
        word('know', 4.5, 4.8),
        word('now.', 4.9, 5.3),
      ],
    });

    expect(textsOf(lines)).toEqual([
      ['Is', 'this', 'the', 'real', 'life.'],
      ['Oh', 'I', 'see', 'it.'],
      ['Yeah', 'you', 'know', 'now.'],
    ]);
  });

  it('breaks on weak punctuation only when the line is already long', () => {
    const short = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [word('well,', 0, 0.3), word('hello', 0.4, 0.7)],
    });
    const long = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [
        word('one', 0, 0.3),
        word('two', 0.4, 0.7),
        word('three', 0.8, 1.1),
        word('four', 1.2, 1.5),
        word('five', 1.6, 1.9),
        word('six', 2.0, 2.3),
        word('seven', 2.4, 2.7),
        word('eight,', 2.8, 3.1),
        word('nine', 3.2, 3.5),
        word('ten', 3.6, 3.9),
        word('eleven', 4.0, 4.4),
      ],
    });

    expect(textsOf(short)).toEqual([['well,', 'hello']]);
    expect(textsOf(long)).toEqual([
      ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight,'],
      ['nine', 'ten', 'eleven'],
    ]);
  });

  it('always breaks when the speaker changes', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [
        word('hello', 0, 0.4, 'SPEAKER_00'),
        word('there', 0.5, 0.9, 'SPEAKER_01'),
      ],
    });

    expect(textsOf(lines)).toEqual([['hello'], ['there']]);
  });

  it('splits a line past 12 words before a conjunction', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [
        word('one', 0, 0.3),
        word('two', 0.5, 0.8),
        word('three', 1.0, 1.3),
        word('four', 1.5, 1.8),
        word('five', 2.0, 2.3),
        word('six', 2.5, 2.8),
        word('seven', 3.0, 3.3),
        word('eight', 3.5, 3.8),
        word('nine', 4.0, 4.3),
        word('and', 4.5, 4.8),
        word('ten', 5.0, 5.3),
        word('eleven', 5.5, 5.8),
        word('twelve', 6.0, 6.3),
      ],
    });

    expect(textsOf(lines)).toEqual([
      ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
      ['and', 'ten', 'eleven', 'twelve'],
    ]);
  });

  it('splits a line past 75 chars', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [
        word('aaaaaaaa', 0, 0.4),
        word('bbbbbbbb', 0.5, 0.9),
        word('cccccccc', 1.0, 1.4),
        word('dddddddd', 1.5, 1.9),
        word('eeeeeeee', 2.0, 2.4),
        word('ffffffff', 2.5, 2.9),
        word('gggggggg', 3.0, 3.4),
        word('hhhhhhhh', 3.5, 3.9),
        word('iiiiiiii', 4.0, 4.4),
      ],
    });

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(lineText(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('splits a line past 7 seconds', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [
        word('one', 0, 0.6),
        word('two', 0.9, 1.5),
        word('three', 1.8, 2.4),
        word('four', 2.7, 3.3),
        word('five', 3.6, 4.2),
        word('six', 4.5, 5.1),
        word('seven', 5.4, 6.0),
        word('eight', 6.3, 6.9),
        word('nine', 7.2, 7.8),
        word('ten', 8.1, 8.7),
      ],
    });

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.end - line.start).toBeLessThanOrEqual(7);
    }
  });

  it('splits a line past 20 chars per second', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [
        word('aaa', 0, 0.16),
        word('bbb', 0.18, 0.34),
        word('ccc', 0.36, 0.52),
        word('ddd', 0.54, 0.7),
        word('eee', 0.72, 0.88),
        word('fff', 0.9, 1.06),
      ],
    });

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const cps = lineText(line).length / (line.end - line.start);
      expect(cps).toBeLessThanOrEqual(20);
    }
  });

  it('merges a stub line into a close neighbor', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [
        word('Is', 0, 0.3),
        word('this', 0.4, 0.7),
        word('the', 0.8, 1.1),
        word('real', 1.2, 1.5),
        word('life.', 1.6, 1.9),
        word('oh', 2.1, 2.3),
        word('yeah', 2.4, 2.7),
      ],
    });

    expect(textsOf(lines)).toEqual([
      ['Is', 'this', 'the', 'real', 'life.', 'oh', 'yeah'],
    ]);
  });

  it('keeps a stub line across a gap at or above 0.5s', () => {
    const lines = timedLyricsOf({
      segments: GIANT_SEGMENT,
      words: [
        word('Is', 0, 0.3),
        word('this', 0.4, 0.7),
        word('the', 0.8, 1.1),
        word('real', 1.2, 1.5),
        word('life.', 1.6, 1.9),
        word('oh', 2.5, 2.7),
        word('yeah', 2.8, 3.1),
      ],
    });

    expect(textsOf(lines)).toEqual([
      ['Is', 'this', 'the', 'real', 'life.'],
      ['oh', 'yeah'],
    ]);
  });

  it('answers no lines for an empty transcription', () => {
    expect(timedLyricsOf({ segments: [], words: [] })).toEqual([]);
  });

  it('builds many short lines from one realistic long word stream', () => {
    const words = [
      word('Mama,', 0.5, 0.9),
      word('just', 1.0, 1.2),
      word('killed', 1.3, 1.7),
      word('a', 1.8, 1.9),
      word('man.', 2.0, 2.4),
      word('Put', 3.3, 3.5),
      word('a', 3.6, 3.7),
      word('gun', 3.8, 4.1),
      word('against', 4.2, 4.6),
      word('his', 4.7, 4.9),
      word('head,', 5.0, 5.4),
      word('pulled', 5.5, 5.9),
      word('my', 6.0, 6.2),
      word('trigger,', 6.3, 6.8),
      word('now', 6.9, 7.2),
      word("he's", 7.3, 7.6),
      word('dead.', 7.7, 8.2),
      word('Mama,', 9.4, 9.8),
      word('life', 9.9, 10.2),
      word('had', 10.3, 10.5),
      word('just', 10.6, 10.8),
      word('begun.', 10.9, 11.4),
      word('Woo', 12.8, 13.1, 'SPEAKER_01'),
      word('yeah', 13.2, 13.5, 'SPEAKER_01'),
      word('Did', 14.0, 14.3),
      word('not', 14.4, 14.6),
      word('mean', 14.7, 15.0),
      word('to', 15.1, 15.2),
      word('make', 15.3, 15.6),
      word('you', 15.7, 15.9),
      word('cry.', 16.0, 16.4),
    ];
    const lines = timedLyricsOf({ segments: GIANT_SEGMENT, words });

    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      expect(line.words.length).toBeGreaterThan(0);
      expect(line.words.length).toBeLessThanOrEqual(12);
      expect(lineText(line).length).toBeLessThanOrEqual(75);
      expect(line.end - line.start).toBeLessThanOrEqual(7);
      const cps = lineText(line).length / (line.end - line.start);
      expect(cps).toBeLessThanOrEqual(20);
    }
    const starts = lines.map((line) => line.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    for (const [index, line] of lines.entries()) {
      const next = lines[index + 1];
      if (next !== undefined) {
        expect(line.end).toBeLessThanOrEqual(next.start);
      }
    }
    expect(lines[0]?.words[0]).toMatchObject({ text: 'Mama,', start: 0.5 });
  });
});
