'use client';

import type { TrackLyricLine } from '@vozzify/contracts';

import { cn } from '@/lib/utils';
import { useKaraokeSegments } from '../hooks/use-karaoke-segments';
import {
  type LyricsClock,
  useLyricsSignature,
} from '../hooks/use-lyrics-signature';
import { karaokeLineAt, type WordState, wordStateAt } from '../lyrics-position';

const WORD_CLASS: Record<WordState, string> = {
  sung: 'text-foreground',
  current: 'text-primary',
  upcoming: 'text-muted-foreground',
};

/**
 * The line being sung, under the timeline, with the word being sung
 * highlighted. Before the first line starts it shows that line as what comes
 * next; a finished line holds briefly, then the slot previews the next line
 * for read-ahead, and after the last line it clears (keeping its height so
 * the page does not shift). The caller mounts it
 * only once the lyrics are loaded, holding a slot of its height (`min-h-8`)
 * while they load, so the page does not shift when they arrive.
 */
export function KaraokeLine({
  lines,
  clock,
}: {
  lines: readonly TrackLyricLine[];
  clock: LyricsClock;
}) {
  const segments = useKaraokeSegments(lines);
  useLyricsSignature(segments.lines, clock);
  const time = clock.now();
  const display = karaokeLineAt(segments.lines, time);
  const line = display < 0 ? undefined : segments.lines[display];
  if (line === undefined) {
    return (
      <p
        ref={segments.ref}
        data-testid="karaoke-line"
        className="h-8 min-w-0 whitespace-nowrap text-center font-semibold text-lg leading-8 md:text-xl"
      />
    );
  }

  return (
    <p
      ref={segments.ref}
      data-testid="karaoke-line"
      className="h-8 min-w-0 whitespace-nowrap text-center font-semibold text-lg leading-8 md:text-xl"
    >
      <span style={{ fontSize: segments.fontSize(line) }}>
        {line.words.map((word, index) => {
          const state = wordStateAt(word, time);
          return (
            <span
              // A line's words are fixed, so the position is their identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: the same word can repeat in a line.
              key={index}
              data-state={state}
              className={cn(
                'transition-colors duration-150',
                WORD_CLASS[state],
              )}
            >
              {index > 0 ? ' ' : null}
              {word.text}
            </span>
          );
        })}
      </span>
    </p>
  );
}
