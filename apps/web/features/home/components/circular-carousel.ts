'use client';

import {
  Children,
  cloneElement,
  type FocusEvent,
  isValidElement,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { type PendingFocus, useLogicalFocus } from './circular-carousel-focus';
import {
  segmentWidth,
  useLooping,
  useRecenterOnScroll,
} from './circular-carousel-geometry';

type Copy = 'before' | 'middle' | 'after';
function carouselChildren(children: ReactNode, copy: Copy, position: number) {
  return Children.toArray(children).map((child) => {
    if (!isValidElement(child)) return child;
    const element = child as ReactElement<Record<string, unknown>>;
    return cloneElement(element, {
      key: `segment-${position}-${child.key ?? 'item'}`,
      carouselCopy: copy,
    });
  });
}

function queueSeamFocus({
  track,
  destination,
  direction,
  center,
  setCenter,
  pendingFocus,
}: {
  track: HTMLUListElement;
  destination: HTMLElement;
  direction: -1 | 1;
  center: number;
  setCenter: (center: number) => void;
  pendingFocus: MutableRefObject<PendingFocus | null>;
}): void {
  const width = segmentWidth(track);
  const nextCenter = (center + direction + 3) % 3;
  const cardWidth = destination.getBoundingClientRect().width;
  pendingFocus.current = {
    id: destination.dataset.homeItemId ?? '',
    shift: width === undefined ? 0 : -direction * (width - cardWidth),
    center: nextCenter,
  };
  setCenter(nextCenter);
}

function moveKeyboardFocus({
  track,
  event,
  looping,
  center,
  setCenter,
  pendingFocus,
}: {
  track: HTMLUListElement;
  event: KeyboardEvent<HTMLUListElement>;
  looping: boolean;
  center: number;
  setCenter: (center: number) => void;
  pendingFocus: MutableRefObject<PendingFocus | null>;
}): void {
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
  const wrapped = looping && (nextIndex < 0 || nextIndex >= cards.length);
  const destination = wrapped
    ? cards[(nextIndex + cards.length) % cards.length]
    : cards[nextIndex];
  const link = destination?.querySelector<HTMLAnchorElement>('a[href]');
  if (!destination || !link) return;
  event.preventDefault();
  if (wrapped) {
    queueSeamFocus({
      track,
      destination,
      direction: event.key === 'ArrowRight' ? 1 : -1,
      center,
      setCenter,
      pendingFocus,
    });
    return;
  }
  link.focus();
}

function moveFocusToLogicalCopy(
  event: FocusEvent<HTMLUListElement> | ReactMouseEvent<HTMLUListElement>,
  center: number,
  setCenter: (center: number) => void,
  pendingFocus: MutableRefObject<PendingFocus | null>,
): void {
  const link =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('a[href]')
      : null;
  const copy = link?.closest<HTMLElement>(
    'li[data-carousel-copy="before"], li[data-carousel-copy="after"]',
  );
  if (!copy?.dataset.homeItemId) return;
  link?.blur();
  const direction = copy.dataset.carouselCopy === 'after' ? 1 : -1;
  const width = segmentWidth(event.currentTarget);
  const nextCenter = (center + direction + 3) % 3;
  pendingFocus.current = {
    id: copy.dataset.homeItemId,
    shift: width === undefined ? 0 : -direction * width,
    center: nextCenter,
  };
  setCenter(nextCenter);
}

function orderedCopies(center: number): Copy[] {
  const copies: Copy[] = ['before', 'middle', 'after'];
  return [0, 1, 2].map(
    (position) => copies[(position - center + 1 + 3) % 3] ?? 'middle',
  );
}

function setCopyTabStops(track: HTMLUListElement, center: number): void {
  const children = Array.from(track.children);
  const itemsPerSegment = children.length / 3;
  for (const [position, copy] of orderedCopies(center).entries()) {
    const start = position * itemsPerSegment;
    const end = start + itemsPerSegment;
    for (const item of children.slice(start, end)) {
      for (const link of item.querySelectorAll<HTMLAnchorElement>('a')) {
        if (copy === 'middle') link.removeAttribute('tabindex');
        else link.tabIndex = -1;
      }
    }
  }
}

function useHideCopiesFromTabOrder(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  looping: boolean,
  center: number,
): void {
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    if (!looping) {
      for (const link of track.querySelectorAll<HTMLAnchorElement>('a')) {
        link.removeAttribute('tabindex');
      }
      return;
    }
    setCopyTabStops(track, center);
  }, [center, looping, trackRef.current]);
}

function useCopyFocus(
  center: number,
  setCenter: (center: number) => void,
  pendingFocus: MutableRefObject<PendingFocus | null>,
) {
  const pointerInteraction = useRef(false);
  const onFocusCapture = (event: FocusEvent<HTMLUListElement>) => {
    if (!pointerInteraction.current)
      moveFocusToLogicalCopy(event, center, setCenter, pendingFocus);
  };
  const onPointerClickCapture = (event: ReactMouseEvent<HTMLUListElement>) => {
    pointerInteraction.current = false;
    moveFocusToLogicalCopy(event, center, setCenter, pendingFocus);
  };
  return {
    onFocusCapture,
    onPointerDownCapture: () => {
      pointerInteraction.current = true;
    },
    onPointerUpCapture: () => {
      pointerInteraction.current = false;
    },
    onPointerCancelCapture: () => {
      pointerInteraction.current = false;
    },
    onClickCapture: onPointerClickCapture,
    onAuxClickCapture: onPointerClickCapture,
  };
}

function scrollByPage(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  direction: 'left' | 'right',
): void {
  const track = trackRef.current;
  if (!track) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  track.scrollBy({
    left: (direction === 'left' ? -1 : 1) * track.clientWidth,
    behavior: reduce ? 'auto' : 'smooth',
  });
}

export function useCircularCarousel(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  children: ReactNode,
  exhausted: boolean,
) {
  const { looping, centered } = useLooping(trackRef, exhausted);
  const [center, setCenter] = useState(1);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const copyFocus = useCopyFocus(center, setCenter, pendingFocus);
  useRecenterOnScroll(trackRef, looping && centered, setCenter);
  useHideCopiesFromTabOrder(trackRef, looping, center);

  useLayoutEffect(() => {
    if (looping) return;
    setCenter(1);
    pendingFocus.current = null;
  }, [looping]);

  useLogicalFocus(trackRef, center, pendingFocus);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const track = trackRef.current;
    if (track) {
      moveKeyboardFocus({
        track,
        event,
        looping,
        center,
        setCenter,
        pendingFocus,
      });
    }
  };
  return {
    looping,
    children: looping
      ? orderedCopies(center).flatMap((copy, position) =>
          carouselChildren(children, copy, position),
        )
      : children,
    onKeyDown,
    ...copyFocus,
    scrollByPage: (direction: 'left' | 'right') =>
      scrollByPage(trackRef, direction),
  };
}
