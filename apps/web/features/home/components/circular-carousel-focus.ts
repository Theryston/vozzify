'use client';

import { type MutableRefObject, useLayoutEffect, useRef } from 'react';

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

function focusedTrackId(
  track: HTMLUListElement | null,
  element: EventTarget | null,
): string | undefined {
  return element instanceof Element && track?.contains(element)
    ? element.closest<HTMLElement>('li[data-home-item-id]')?.dataset.homeItemId
    : undefined;
}

function useRememberedFocus(
  trackRef: MutableRefObject<HTMLUListElement | null>,
) {
  const focusedId = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    focusedId.current = focusedTrackId(
      trackRef.current,
      document.activeElement,
    );
    const remember = (event: FocusEvent) => {
      focusedId.current = focusedTrackId(trackRef.current, event.target);
    };
    const clearOutside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        !trackRef.current?.contains(event.target)
      ) {
        focusedId.current = undefined;
      }
    };
    const clearBlur = (event: FocusEvent) => {
      if (
        event.relatedTarget === null &&
        event.target instanceof Node &&
        event.target.isConnected
      ) {
        focusedId.current = undefined;
      }
    };
    document.addEventListener('focusin', remember);
    document.addEventListener('focusout', clearBlur);
    document.addEventListener('pointerdown', clearOutside);
    return () => {
      document.removeEventListener('focusin', remember);
      document.removeEventListener('focusout', clearBlur);
      document.removeEventListener('pointerdown', clearOutside);
    };
  }, [trackRef]);
  return focusedId;
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

export function useLogicalFocus(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  center: number,
  pendingFocus: MutableRefObject<PendingFocus | null>,
  looping: boolean,
): void {
  const remembered = useRememberedFocus(trackRef);
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    const track = trackRef.current;
    if (!track || (pending && pending.center !== center)) return;
    // Changing the presentation remounts links; remember their identity before
    // the browser moves focus to body when the old focused link is removed.
    const id = pending?.id ?? logicalFocusId(track, remembered.current);
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
  }, [center, looping, pendingFocus, remembered, trackRef]);
}
