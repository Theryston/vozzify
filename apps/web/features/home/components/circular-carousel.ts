'use client';

import {
  Children,
  cloneElement,
  type FocusEvent,
  isValidElement,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';

const EDGE_TOLERANCE = 2;
type Copy = 'before' | 'middle' | 'after';

function carouselChildren(children: ReactNode, copy: Copy) {
  return Children.toArray(children).map((child) => {
    if (!isValidElement(child)) return child;
    const element = child as ReactElement<Record<string, unknown>>;
    return cloneElement(element, {
      key: `${copy}-${child.key ?? 'item'}`,
      'data-carousel-copy': copy,
      ...(copy === 'middle'
        ? {}
        : {
            'aria-hidden': true,
          }),
    });
  });
}

function moveKeyboardFocus(
  track: HTMLUListElement,
  event: KeyboardEvent<HTMLUListElement>,
  looping: boolean,
): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (!(event.target instanceof Element)) return;
  const current = event.target.closest<HTMLElement>(
    'li[data-carousel-copy="middle"][data-home-item-id]',
  );
  if (!current) return;
  const cards = Array.from(
    track.querySelectorAll<HTMLElement>(
      'li[data-carousel-copy="middle"][data-home-item-id]',
    ),
  );
  const index = cards.indexOf(current);
  const nextIndex = index + (event.key === 'ArrowRight' ? 1 : -1);
  const destination = looping
    ? cards[(nextIndex + cards.length) % cards.length]
    : cards[nextIndex];
  const link = destination?.querySelector<HTMLAnchorElement>('a[href]');
  if (!link) return;
  event.preventDefault();
  link.focus();
}

function moveFocusToLogicalCopy(
  track: HTMLUListElement,
  event: FocusEvent<HTMLUListElement>,
): void {
  if (!(event.target instanceof Element)) return;
  const copy = event.target.closest<HTMLElement>(
    'li[data-carousel-copy="before"], li[data-carousel-copy="after"]',
  );
  const itemId = copy?.dataset.homeItemId;
  if (!itemId) return;
  const canonical = Array.from(
    track.querySelectorAll<HTMLElement>(
      'li[data-carousel-copy="middle"][data-home-item-id]',
    ),
  ).find((item) => item.dataset.homeItemId === itemId);
  canonical?.querySelector<HTMLAnchorElement>('a[href]')?.focus({
    preventScroll: true,
  });
}

function recenter(track: HTMLUListElement): void {
  const segmentStart = segmentWidth(track);
  if (segmentStart === undefined || segmentStart <= 0) return;
  const segmentEnd = segmentStart * 2;
  if (track.scrollLeft < segmentStart) {
    track.scrollLeft += segmentStart;
  } else if (track.scrollLeft > segmentEnd) {
    track.scrollLeft -= segmentStart;
  }
}

function segmentWidth(track: HTMLUListElement): number | undefined {
  const before = track.querySelector<HTMLElement>(
    '[data-carousel-copy="before"]',
  );
  const middle = track.querySelector<HTMLElement>(
    '[data-carousel-copy="middle"]',
  );
  if (!before || !middle) return undefined;
  return (
    middle.getBoundingClientRect().left - before.getBoundingClientRect().left
  );
}

function useLooping(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  exhausted: boolean,
): boolean {
  const [looping, setLooping] = useState(false);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () => updateLooping(track, looping, exhausted, setLooping);
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
  return looping;
}

function updateLooping(
  track: HTMLUListElement,
  looping: boolean,
  exhausted: boolean,
  setLooping: (looping: boolean) => void,
): void {
  const width = segmentWidth(track);
  const contentWidth = looping ? width : track.scrollWidth;
  const overflow =
    contentWidth !== undefined &&
    contentWidth - track.clientWidth > EDGE_TOLERANCE;
  const shouldLoop = exhausted && overflow;
  if (shouldLoop === looping) return;
  const previousOffset = track.scrollLeft;
  const first = track.firstElementChild;
  const firstOffset = first
    ? first.getBoundingClientRect().left - track.getBoundingClientRect().left
    : 0;
  setLooping(shouldLoop);
  if (shouldLoop) {
    requestAnimationFrame(() => {
      const middle = track.querySelector<HTMLElement>(
        '[data-carousel-copy="middle"]',
      );
      if (!middle) return;
      const middleOffset =
        middle.getBoundingClientRect().left -
        track.getBoundingClientRect().left;
      track.scrollLeft = previousOffset + middleOffset - firstOffset;
    });
  }
}

function useRecenterOnScroll(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  looping: boolean,
): void {
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !looping) return;
    const update = () => recenter(track);
    track.addEventListener('scroll', update, { passive: true });
    return () => track.removeEventListener('scroll', update);
  }, [looping, trackRef]);
}

function useHideCopiesFromTabOrder(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  looping: boolean,
): void {
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || !looping) return;
    const selector =
      '[data-carousel-copy="before"] a, [data-carousel-copy="after"] a';
    for (const link of track.querySelectorAll<HTMLAnchorElement>(selector)) {
      link.tabIndex = -1;
    }
  }, [looping, trackRef.current]);
}

export function useCircularCarousel(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  children: ReactNode,
  exhausted: boolean,
) {
  const looping = useLooping(trackRef, exhausted);
  useRecenterOnScroll(trackRef, looping);
  useHideCopiesFromTabOrder(trackRef, looping);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const track = trackRef.current;
    if (track) moveKeyboardFocus(track, event, looping);
  };
  const onFocusCapture = (event: FocusEvent<HTMLUListElement>) => {
    const track = trackRef.current;
    if (track) moveFocusToLogicalCopy(track, event);
  };
  const scrollByPage = (direction: 'left' | 'right') => {
    const track = trackRef.current;
    if (!track) return;
    const reduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    track.scrollBy({
      left: (direction === 'left' ? -1 : 1) * track.clientWidth,
      behavior: reduce ? 'auto' : 'smooth',
    });
  };

  return {
    looping,
    children: looping
      ? [
          ...carouselChildren(children, 'before'),
          ...carouselChildren(children, 'middle'),
          ...carouselChildren(children, 'after'),
        ]
      : children,
    onKeyDown,
    onFocusCapture,
    scrollByPage,
  };
}
