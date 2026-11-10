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

export function useLogicalFocus(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  center: number,
  pendingFocus: MutableRefObject<PendingFocus | null>,
): void {
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    const track = trackRef.current;
    if (!track || (pending && pending.center !== center)) return;
    const active = document.activeElement;
    const focusedCard =
      active instanceof HTMLElement && track.contains(active)
        ? active.closest<HTMLElement>('li[data-home-item-id]')
        : null;
    const id = pending?.id ?? focusedCard?.dataset.homeItemId;
    if (!id) return;
    pendingFocus.current = null;
    if (pending) track.scrollLeft += pending.shift;
    const destination = Array.from(
      track.querySelectorAll<HTMLElement>(
        'li[data-carousel-copy="middle"][data-home-item-id]',
      ),
    ).find((item) => item.dataset.homeItemId === id);
    if (pending) focusVisibleItem(track, destination);
    else
      destination?.querySelector<HTMLAnchorElement>('a[href]')?.focus({
        preventScroll: true,
      });
  }, [center, pendingFocus, trackRef]);
}
