'use client';

import type { TrackLyricLine } from '@vozzify/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { karaokeSegments } from '../karaoke-segments';

/** Measure with the actual font, including after it loads or fullscreen resizes. */
export function useKaraokeSegments(lines: readonly TrackLyricLine[]) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [layout, setLayout] = useState({ width: 0, font: '', size: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const style = getComputedStyle(element);
      const width = element.getBoundingClientRect().width;
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const size = Number.parseFloat(style.fontSize);
      setLayout((previous) =>
        previous.width === width && previous.font === font
          ? previous
          : { width, font, size },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    void document.fonts.ready.then(measure);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);

  const measured = useMemo(() => {
    if (layout.width <= 0) return { lines, context: null };
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return { lines, context };
    context.font = layout.font;
    return {
      lines: karaokeSegments(
        lines,
        layout.width,
        (text) => context.measureText(text).width,
      ),
      context,
    };
  }, [lines, layout]);

  // A single word wider than the slot stays whole, at a size that fits it.
  const fontSize = (line: TrackLyricLine | undefined) => {
    if (!line || !measured.context) return undefined;
    const text = line.words.map((word) => word.text).join(' ');
    const width = measured.context.measureText(text).width;
    return width > layout.width
      ? (layout.size * layout.width) / width
      : undefined;
  };
  return { ref, lines: measured.lines, fontSize };
}
