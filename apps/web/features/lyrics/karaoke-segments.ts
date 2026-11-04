import type { TrackLyricLine, TrackLyricWord } from '@vozzify/contracts';

/** Splits only the karaoke display; the stored lyrics and word times stay intact. */
export function karaokeSegments(
  lines: readonly TrackLyricLine[],
  width: number,
  measure: (text: string) => number,
): readonly TrackLyricLine[] {
  if (width <= 0) return lines;
  return lines.flatMap((line) => splitLine(line, width, measure));
}

function splitLine(
  line: TrackLyricLine,
  width: number,
  measure: (text: string) => number,
): TrackLyricLine[] {
  const groups: TrackLyricWord[][] = [];
  let group: TrackLyricWord[] = [];
  for (const word of line.words) {
    const text = [...group, word].map((item) => item.text).join(' ');
    if (group.length > 0 && measure(text) > width) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length > 0) groups.push(group);
  if (groups.length <= 1) return [line];
  return groups.map((words, index) => ({
    // Keep the original boundaries for previews and the final hold; each
    // continuation switches exactly when its first word begins.
    start: index === 0 ? line.start : (words[0]?.start ?? line.start),
    end: Math.max(
      index === groups.length - 1 ? line.end : 0,
      ...words.map((word) => word.end),
    ),
    words,
  }));
}
