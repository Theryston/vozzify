import type { Transcription } from './scribe-output.js';

// The Timed lyrics of a transcription (CONTEXT.md "Timed lyrics"), built from
// word timestamps only. Provider segments are ignored: a long provider segment
// with dozens of words becomes many short lines, while already-short word
// streams keep their natural grouping. The pipeline is deterministic, so
// thresholds are tuned with unit tests only.
//
// Order: sort words by start, break into phrases (speaker change, terminal
// punctuation, hard and soft silence, weak punctuation), split phrases that
// exceed the safety caps (preferring a boundary before a conjunction), then
// merge stub lines into a close neighbor. Spans run from first-word start to
// last-word end; output is sorted, non-overlapping and has no empty lines.

/** One word of Timed lyrics, timed to the Track's audio in seconds. */
type TimedLyricWord = { text: string; start: number; end: number };

/** One line of Timed lyrics: its words, in the order they are sung. */
export type TimedLyricLine = {
  start: number;
  end: number;
  words: TimedLyricWord[];
};

/**
 * A transcribed word with its timing, plus the diarized voice when the
 * transcription carries one. Words without a voice never break on it.
 */
type InputWord = Transcription['words'][number] & {
  speaker?: string;
};

/** What the line builder reads. Segments ride along so callers keep passing
 * the whole transcription; they are never read. */
type WordsOnlyTranscription = {
  segments: Transcription['segments'];
  words: readonly InputWord[];
};

/** A word under construction: trimmed text with its timing and speaker. */
type LyricWord = { text: string; start: number; end: number; speaker?: string };

// A phrase gap is a real silence; a smaller one only breaks a line that
// already has body behind it.
const HARD_SILENCE_GAP = 1.2;
const SOFT_SILENCE_GAP = 0.7;
const SOFT_BODY_WORDS = 5;
const SOFT_BODY_CHARS = 30;

// A comma-like mark only breaks a line that is already long.
const WEAK_LONG_WORDS = 8;
const WEAK_LONG_CHARS = 50;

// No stored line exceeds any of these.
const MAX_LINE_WORDS = 12;
const MAX_LINE_CHARS = 75;
const MAX_LINE_SECONDS = 7;
const MAX_LINE_CPS = 20;

// A stub is a fragment too short to sing alone; it joins a close neighbor.
const STUB_MERGE_GAP = 0.5;

const TERMINAL_PUNCTUATION = new Set(['.', '!', '?']);
const WEAK_PUNCTUATION = new Set([',', ';', ':', '-', '–', '—']);

// Words a new line prefers to start with when a cap forces a split. English
// only: other languages still split within caps, just without the preference.
const CONJUNCTIONS = new Set([
  'and',
  'but',
  'or',
  'nor',
  'for',
  'yet',
  'so',
  'because',
  'although',
  'though',
  'while',
  'whereas',
  'however',
]);

const byStart = <T extends { start: number }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.start - b.start);

/** The words that have text, trimmed of the blank around them. */
const wordsOf = (words: readonly InputWord[]): LyricWord[] =>
  words.flatMap(({ word, start, end, speaker }) => {
    const text = word.trim();
    return text === '' ? [] : [{ text, start, end, speaker }];
  });

const textOf = (words: readonly LyricWord[]): string =>
  words.map((word) => word.text).join(' ');

const charsOf = (words: readonly LyricWord[]): number => textOf(words).length;

const durationOf = (words: readonly LyricWord[]): number => {
  const first = words.at(0);
  const last = words.at(-1);
  if (first === undefined || last === undefined) {
    return 0;
  }
  return last.end - first.start;
};

const cpsOf = (words: readonly LyricWord[]): number => {
  const duration = durationOf(words);
  if (duration <= 0) {
    return charsOf(words) > 0 ? Number.POSITIVE_INFINITY : 0;
  }
  return charsOf(words) / duration;
};

/** Whether a candidate line already exceeds a safety cap. */
const exceedsCaps = (words: readonly LyricWord[]): boolean =>
  words.length > MAX_LINE_WORDS ||
  charsOf(words) > MAX_LINE_CHARS ||
  durationOf(words) > MAX_LINE_SECONDS ||
  cpsOf(words) > MAX_LINE_CPS;

/** Whether the line under construction already has body for a soft break. */
const hasBody = (words: readonly LyricWord[]): boolean =>
  words.length >= SOFT_BODY_WORDS || charsOf(words) >= SOFT_BODY_CHARS;

/** Whether the line under construction is long enough for a weak break. */
const isLong = (words: readonly LyricWord[]): boolean =>
  words.length >= WEAK_LONG_WORDS || charsOf(words) >= WEAK_LONG_CHARS;

/** Whether a fragment is too short to stand as its own line. */
const isStub = (words: readonly LyricWord[]): boolean =>
  words.length > 0 && words.length < 3 && charsOf(words) < 20;

const lastCharOf = (text: string): string => text.at(-1) ?? '';

const endsTerminal = (text: string): boolean =>
  TERMINAL_PUNCTUATION.has(lastCharOf(text));

const endsWeak = (text: string): boolean =>
  WEAK_PUNCTUATION.has(lastCharOf(text));

const isConjunction = (text: string): boolean =>
  CONJUNCTIONS.has(text.toLowerCase().replace(/[^a-z]/g, ''));

const gapBetween = (previous: LyricWord, next: LyricWord): number =>
  next.start - previous.end;

const gapBetweenLines = (
  previous: readonly LyricWord[],
  next: readonly LyricWord[],
): number => {
  const end = previous.at(-1);
  const start = next.at(0);
  if (end === undefined || start === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  return gapBetween(end, start);
};

/** Whether the next word starts a new line after the current one. */
const breaksBefore = (
  current: readonly LyricWord[],
  previous: LyricWord,
  next: LyricWord,
): boolean => {
  if (previous.speaker !== next.speaker) {
    return true;
  }
  if (endsTerminal(previous.text)) {
    return true;
  }
  const gap = gapBetween(previous, next);
  if (gap >= HARD_SILENCE_GAP) {
    return true;
  }
  if (gap >= SOFT_SILENCE_GAP && hasBody(current)) {
    return true;
  }
  return endsWeak(previous.text) && isLong(current);
};

/** Phrases from the break rules, before caps and merges. */
const phrasesOf = (words: readonly LyricWord[]): LyricWord[][] => {
  const phrases: LyricWord[][] = [];
  for (const word of words) {
    const current = phrases.at(-1);
    if (current === undefined) {
      phrases.push([word]);
      continue;
    }
    const previous = current.at(-1);
    if (previous === undefined) {
      current.push(word);
      continue;
    }
    if (breaksBefore(current, previous, word)) {
      phrases.push([word]);
    } else {
      current.push(word);
    }
  }
  return phrases;
};

/** The longest prefix of words that stays within every cap. */
const maxPrefixWithinCaps = (words: readonly LyricWord[]): number => {
  let end = 1;
  while (
    end < words.length &&
    !exceedsCaps(words.slice(0, end + 1)) &&
    end + 1 <= words.length
  ) {
    end += 1;
  }
  return end;
};

/** Where an overlong phrase splits: the last boundary before a conjunction
 * within caps, else the furthest boundary within caps. */
const splitPointOf = (words: readonly LyricWord[]): number => {
  const furthest = maxPrefixWithinCaps(words);
  if (furthest <= 1 || furthest >= words.length) {
    return Math.min(Math.max(furthest, 1), words.length - 1);
  }
  for (let at = furthest; at >= 1; at -= 1) {
    const candidate = words.at(at);
    if (candidate !== undefined && isConjunction(candidate.text)) {
      return at;
    }
  }
  return furthest;
};

/** One phrase split into lines that each fit the safety caps. */
const splitLongPhrase = (words: readonly LyricWord[]): LyricWord[][] => {
  if (words.length <= 1 || !exceedsCaps(words)) {
    return [[...words]];
  }
  const chunks: LyricWord[][] = [];
  let rest = [...words];
  while (rest.length > 0) {
    if (!exceedsCaps(rest)) {
      chunks.push(rest);
      break;
    }
    if (rest.length <= 1) {
      chunks.push(rest);
      break;
    }
    const at = splitPointOf(rest);
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  return chunks;
};

/** Whether two neighbors may merge: same voice and still within caps. */
const canMerge = (
  previous: readonly LyricWord[],
  next: readonly LyricWord[],
): boolean => {
  const first = previous.at(0);
  const other = next.at(0);
  if (first?.speaker !== other?.speaker) {
    return false;
  }
  return !exceedsCaps([...previous, ...next]);
};

/** Stub lines folded into a close neighbor, preferring the previous one. A
 * stub merges even across a terminal-punctuation break (the stub wins), but
 * never across speakers, and a stub that would break caps stays on its own. */
const mergedOf = (phrases: readonly LyricWord[][]): LyricWord[][] => {
  const merged: LyricWord[][] = [];
  for (const phrase of phrases) {
    const previous = merged.at(-1);
    if (
      previous !== undefined &&
      (isStub(previous) || isStub(phrase)) &&
      gapBetweenLines(previous, phrase) < STUB_MERGE_GAP &&
      canMerge(previous, phrase)
    ) {
      merged[merged.length - 1] = [...previous, ...phrase];
    } else {
      merged.push([...phrase]);
    }
  }
  return merged;
};

/**
 * The Timed lines of a transcription, from its words only. Consecutive words
 * become lines through the break pipeline, overlong phrases split within the
 * safety caps, and stub fragments merge into a close neighbor. Lines come out
 * in the order they are sung; a transcription without words makes no line.
 */
export const timedLyricsOf = (
  transcription: WordsOnlyTranscription,
): TimedLyricLine[] => {
  const words = byStart(wordsOf(transcription.words));
  const phrases = phrasesOf(words).flatMap(splitLongPhrase);
  return mergedOf(phrases).flatMap((phrase) => {
    const first = phrase.at(0);
    const last = phrase.at(-1);
    if (first === undefined || last === undefined) {
      return [];
    }
    return [
      {
        start: first.start,
        end: last.end,
        words: phrase.map(({ text, start, end }) => ({ text, start, end })),
      },
    ];
  });
};
