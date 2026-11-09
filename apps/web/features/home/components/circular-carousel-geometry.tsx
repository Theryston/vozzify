'use client';

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';

const EDGE_TOLERANCE = 2;
type LoopingUpdate = {
  track: HTMLUListElement;
  looping: boolean;
  exhausted: boolean;
  setLooping: (looping: boolean) => void;
  setCentered: (centered: boolean) => void;
};

export function segmentWidth(track: HTMLUListElement): number | undefined {
  const children = Array.from(track.children);
  const itemsPerSegment = children.length / 3;
  if (!Number.isInteger(itemsPerSegment) || itemsPerSegment === 0) {
    return undefined;
  }
  const first = children[0];
  const second = children[itemsPerSegment];
  if (!first || !second) return undefined;
  return (
    second.getBoundingClientRect().left - first.getBoundingClientRect().left
  );
}

function recenter(
  track: HTMLUListElement,
  setCenter: Dispatch<SetStateAction<number>>,
): void {
  const segmentStart = segmentWidth(track);
  if (segmentStart === undefined || segmentStart <= 0) return;
  const segmentEnd = segmentStart * 2;
  if (track.scrollLeft < segmentStart - track.clientWidth) {
    track.scrollLeft += segmentStart;
    setCenter((center) => (center + 2) % 3);
  } else if (track.scrollLeft > segmentEnd) {
    track.scrollLeft -= segmentStart;
    setCenter((center) => (center + 1) % 3);
  }
}

function updateLooping({
  track,
  looping,
  exhausted,
  setLooping,
  setCentered,
}: LoopingUpdate): void {
  const width = segmentWidth(track);
  const contentWidth = looping ? width : track.scrollWidth;
  const overflow =
    contentWidth !== undefined &&
    contentWidth - track.clientWidth > EDGE_TOLERANCE;
  const shouldLoop = exhausted && overflow;
  if (shouldLoop === looping) return;
  setLooping(shouldLoop);
  setCentered(false);
}

function centerOnMiddleCopy(track: HTMLUListElement): void {
  const first = track.firstElementChild;
  const middle = track.querySelector<HTMLElement>(
    '[data-carousel-copy="middle"]',
  );
  if (!first || !middle) return;
  const trackLeft = track.getBoundingClientRect().left;
  const firstOffset = first.getBoundingClientRect().left - trackLeft;
  const middleOffset = middle.getBoundingClientRect().left - trackLeft;
  track.scrollLeft += middleOffset - firstOffset;
}

export function useLooping(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  exhausted: boolean,
): { looping: boolean; centered: boolean } {
  const [looping, setLooping] = useState(false);
  const [centered, setCentered] = useState(false);
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || !looping) return;
    centerOnMiddleCopy(track);
    setCentered(true);
  }, [looping, trackRef]);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () =>
      updateLooping({ track, looping, exhausted, setLooping, setCentered });
    update();
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(update);
    resizeObserver?.observe(track);
    const contents = new MutationObserver(update);
    contents.observe(track, { childList: true });
    return () => {
      resizeObserver?.disconnect();
      contents.disconnect();
    };
  }, [exhausted, looping, trackRef]);
  return { looping, centered };
}

export function useRecenterOnScroll(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  looping: boolean,
  setCenter: Dispatch<SetStateAction<number>>,
): void {
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !looping) return;
    const update = () => recenter(track, setCenter);
    track.addEventListener('scroll', update, { passive: true });
    return () => track.removeEventListener('scroll', update);
  }, [looping, setCenter, trackRef]);
}
