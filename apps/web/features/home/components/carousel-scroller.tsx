'use client';

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import { CAROUSEL_TRACK_CLASS } from '../layout-dimensions';

/** Pixels of tolerance for fractional scroll positions. */
const EDGE_TOLERANCE = 2;

/** Whether the track can scroll in each direction from its position now. */
function scrollableDirections(track: HTMLUListElement | null): {
  left: boolean;
  right: boolean;
} {
  if (!track) return { left: false, right: false };
  const max = track.scrollWidth - track.clientWidth;
  return {
    left: track.scrollLeft > EDGE_TOLERANCE,
    right: max - track.scrollLeft > EDGE_TOLERANCE,
  };
}

type ArrowDirection = 'left' | 'right';

function useTrackUpdates(
  trackRef: MutableRefObject<HTMLUListElement | null>,
  hoverable: boolean,
  onNearEndRef: MutableRefObject<(() => void) | undefined>,
  setDirections: (directions: { left: boolean; right: boolean }) => void,
): void {
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () =>
      updateTrackState(track, hoverable, onNearEndRef, setDirections);
    update();
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(update);
    resizeObserver?.observe(track);
    const contentObserver = new MutationObserver(update);
    contentObserver.observe(track, { childList: true });
    return () => {
      track.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update);
      resizeObserver?.disconnect();
      contentObserver.disconnect();
    };
  }, [hoverable, onNearEndRef, setDirections, trackRef]);
}

function updateTrackState(
  track: HTMLUListElement,
  hoverable: boolean,
  onNearEndRef: MutableRefObject<(() => void) | undefined>,
  setDirections: (directions: { left: boolean; right: boolean }) => void,
): void {
  if (hoverable) setDirections(scrollableDirections(track));
  const rect = track.getBoundingClientRect();
  const visible = rect.bottom > 0 && rect.top < window.innerHeight;
  if (
    visible &&
    track.scrollWidth - track.clientWidth - track.scrollLeft <=
      track.clientWidth
  ) {
    onNearEndRef.current?.();
  }
}

function ArrowButton({
  direction,
  label,
  disabled,
  onScroll,
}: {
  direction: ArrowDirection;
  label: string;
  disabled: boolean;
  onScroll: () => void;
}) {
  const Icon = direction === 'left' ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onScroll}
      className="rounded-full border border-border/60 bg-muted/60 p-1.5 text-foreground outline-none transition-colors duration-150 ease-out hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-30"
    >
      <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
    </button>
  );
}

function ArrowControls({
  directions,
  onScroll,
}: {
  directions: { left: boolean; right: boolean };
  onScroll: (direction: ArrowDirection) => void;
}) {
  const t = useTranslations('home.carousel');
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <ArrowButton
        direction="left"
        label={t('scrollLeft')}
        disabled={!directions.left}
        onScroll={() => onScroll('left')}
      />
      <ArrowButton
        direction="right"
        label={t('scrollRight')}
        disabled={!directions.right}
        onScroll={() => onScroll('right')}
      />
    </div>
  );
}

/**
 * A horizontal row track with its title and edge arrows: on devices with a
 * fine pointer, a pair of arrows sits top-right, justified against the title,
 * and clicking one pages the row by its own width in that direction. Each
 * arrow disables when its side has no content left to scroll to. Touch
 * devices never see the arrows, and rows that fit show none.
 */
export function CarouselScroller({
  header,
  children,
  onNearEnd,
}: {
  header: ReactNode;
  children: ReactNode;
  onNearEnd?: () => void;
}) {
  const trackRef = useRef<HTMLUListElement>(null);
  const onNearEndRef = useRef(onNearEnd);
  const [hoverable, setHoverable] = useState(false);
  const [directions, setDirections] = useState({ left: false, right: false });

  useEffect(() => {
    onNearEndRef.current = onNearEnd;
  }, [onNearEnd]);

  // Desktop only: a coarse pointer never hovers, so the arrows stay out.
  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setHoverable(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useTrackUpdates(trackRef, hoverable, onNearEndRef, setDirections);

  const scroll = (direction: ArrowDirection) => {
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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">{header}</div>
        {hoverable && (directions.left || directions.right) && (
          <ArrowControls directions={directions} onScroll={scroll} />
        )}
      </div>
      <ul ref={trackRef} className={CAROUSEL_TRACK_CLASS}>
        {children}
      </ul>
    </div>
  );
}
