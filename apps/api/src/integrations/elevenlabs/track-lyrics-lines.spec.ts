import { timedLyricsOf } from './track-lyrics-lines.js';

const segment = (start: number, end: number) => ({ start, end });
const word = (text: string, start: number, end: number) => ({
  word: text,
  start,
  end,
});

describe('timedLyricsOf', () => {
  it('times each line from first-word start to last-word end, ignoring segments', () => {
    const lines = timedLyricsOf({
      segments: [segment(0, 2), segment(2, 4)],
      words: [
        word(' Is', 0.1, 0.4),
        word(' this', 0.5, 0.9),
        word(' the', 2.1, 2.4),
        word(' real', 2.5, 3.0),
      ],
    });

    expect(lines).toEqual([
      {
        start: 0.1,
        end: 0.9,
        words: [
          { text: 'Is', start: 0.1, end: 0.4 },
          { text: 'this', start: 0.5, end: 0.9 },
        ],
      },
      {
        start: 2.1,
        end: 3.0,
        words: [
          { text: 'the', start: 2.1, end: 2.4 },
          { text: 'real', start: 2.5, end: 3.0 },
        ],
      },
    ]);
  });

  it('groups words into lines timed by their words, ignoring segments', () => {
    const lines = timedLyricsOf({
      segments: [segment(0, 2), segment(4, 6)],
      words: [
        word(' Is', 0.5, 0.8),
        word(' the', 2.5, 2.8),
        word(' real', 2.9, 3.4),
        word(' life', 4.5, 5.0),
      ],
    });

    expect(lines.map((line) => [line.start, line.end])).toEqual([
      [0.5, 0.8],
      [2.5, 5.0],
    ]);
    expect(lines[1]?.words.map((item) => item.text)).toEqual([
      'the',
      'real',
      'life',
    ]);
  });

  it('breaks the line across a hard silence where a segment ends', () => {
    const lines = timedLyricsOf({
      segments: [segment(0, 2)],
      words: [word(' Is', 0.5, 0.8), word(' the', 2.0, 2.4)],
    });

    expect(lines.map((line) => [line.start, line.end])).toEqual([
      [0.5, 0.8],
      [2.0, 2.4],
    ]);
  });

  it('ignores a segment without words, and drops a word without text', () => {
    const lines = timedLyricsOf({
      segments: [segment(0, 2), segment(2, 4)],
      words: [word(' Is', 0.5, 0.8), word('  ', 0.9, 1.0)],
    });

    expect(lines).toEqual([
      { start: 0.5, end: 0.8, words: [{ text: 'Is', start: 0.5, end: 0.8 }] },
    ]);
  });

  it('sorts segments and words that come out of order', () => {
    const lines = timedLyricsOf({
      segments: [segment(2, 4), segment(0, 2)],
      words: [word(' the', 2.5, 2.9), word(' Is', 0.5, 0.8)],
    });

    expect(lines.map((line) => line.words[0]?.text)).toEqual(['Is', 'the']);
  });

  it('answers no lines for an empty transcription', () => {
    expect(timedLyricsOf({ segments: [], words: [] })).toEqual([]);
  });

  it('keeps the words in a line of their own when there are no segments', () => {
    expect(
      timedLyricsOf({ segments: [], words: [word(' Is', 0.5, 0.8)] }),
    ).toEqual([
      { start: 0.5, end: 0.8, words: [{ text: 'Is', start: 0.5, end: 0.8 }] },
    ]);
  });
});
