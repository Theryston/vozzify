'use client';

import { type MutableRefObject, useLayoutEffect } from 'react';

export type PendingFocus = {
  id: string;
  shift: number;
  center: number;
};

function focusVisibleItem(
  track: HTMLUListElement,
  item: HTMLElement | undefined,
): void {
  if (!item) return;
  const trackBounds = track.getBoundingClientRect();
  const itemBounds = item.getBoundingClientRect();
  if (itemBounds.left < trackBounds.left) {
    track.scrollLeft += itemBounds.left - trackBounds.left;
  } else if (itemBounds.right > trackBounds.right) {
    track.scrollLeft += itemBounds.right - trackBounds.right;
  }
  item.querySelector<HTMLAnchorElement>('a[href]')?.focus({
    preventScroll: true,
  });
}

export function focusedTrackId(
  track: HTMLUListElement | null,
  element: EventTarget | null,
): string | undefined {
  return element instanceof Element && track?.contains(element)
    ? element.closest<HTMLElement>('li[data-home-item-id]')?.dataset.homeItemId
    : undefined;
}

function logicalFocusId(
  track: HTMLUListElement,
  remembered: string | undefined,
): string | undefined {
  const active = document.activeElement;
  return (
    focusedTrackId(track, active) ??
    (active === document.body ? remembered : undefined)
  );
}

type LogicalFocusOptions = {
  trackRef: MutableRefObject<HTMLUListElement | null>;
  center: number;
  pendingFocus: MutableRefObject<PendingFocus | null>;
  looping: boolean;
  transitionFocus: MutableRefObject<string | undefined>;
};

export function useLogicalFocus({
  trackRef,
  center,
  pendingFocus,
  looping,
  transitionFocus,
}: LogicalFocusOptions): void {
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    const track = trackRef.current;
    if (!track || (pending && pending.center !== center)) return;
    const id = pending?.id ?? logicalFocusId(track, transitionFocus.current);
    transitionFocus.current = undefined;
    if (!id) return;
    pendingFocus.current = null;
    if (pending) track.scrollLeft += pending.shift;
    const destination = Array.from(
      track.querySelectorAll<HTMLElement>(
        looping
          ? 'li[data-carousel-copy="middle"][data-home-item-id]'
          : 'li[data-home-item-id]',
      ),
    ).find((item) => item.dataset.homeItemId === id);
    if (pending) focusVisibleItem(track, destination);
    else
      destination?.querySelector<HTMLAnchorElement>('a[href]')?.focus({
        preventScroll: true,
      });
  }, [center, looping, pendingFocus, trackRef, transitionFocus]);
}
