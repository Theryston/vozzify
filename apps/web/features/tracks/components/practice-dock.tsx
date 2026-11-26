'use client';

import type { TrackKey } from '@vozzify/contracts';
import { SettingsIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { type RefObject, useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { DockMicButton } from '@/features/practice/components/dock-mic-button';
import { DockMicNotice } from '@/features/practice/components/dock-mic-notice';
import { useSinging } from '@/features/practice/components/use-singing';
import { StreakRingSkeleton } from '@/features/streaks/components/streak-ring-skeleton';

import type { PlaybackController } from '../playback/playback-controller';
import { YOUTUBE_SQUARE_PX } from '../player/player-port';
import { playbackStore, usePlaybackState } from '../stores/playback-store';
import { DockPlayButton } from './dock-play-button';
import { DockProgressTrack } from './dock-progress-track';
import { TrackKeyContext, TransposeChipPlaceholder } from './transpose-chip';
import { VocalsToggle } from './vocals-toggle';

// Loaded after the page too, for the same reason as the Settings menu: its
// placeholder is the chip itself, so the dock paints complete at once.
const TransposePopover = dynamic(
  () => import('./transpose-popover').then((module) => module.TransposePopover),
  { ssr: false, loading: TransposeChipPlaceholder },
);

/** The custom property the page's bottom padding and the timeline follow. */
const DOCK_HEIGHT_VAR = '--dock-height';

// Loaded after the page, on the client only: Base UI's menu is heavy, and
// keeping it out of the first-load JS is what the placeholder below stands in for.
const DockSettings = dynamic(
  () => import('./dock-settings').then((module) => module.DockSettings),
  { ssr: false, loading: SettingsPlaceholder },
);

// Loaded after the page too: the streak ring brings the popover, the
// heartbeat and the celebration along, which a listener does not need to paint.
const StreakRing = dynamic(
  () =>
    import('@/features/streaks/components/streak-ring').then(
      (module) => module.StreakRing,
    ),
  {
    ssr: false,
    loading: StreakRingSkeleton,
  },
);

function SettingsPlaceholder() {
  const t = useTranslations('tracks.practice.dock');

  return (
    <Button
      variant="ghost"
      size="icon"
      disabled
      aria-label={t('settings')}
      className="md:w-auto md:gap-2 md:px-3"
    >
      <SettingsIcon aria-hidden="true" />
      <span className="hidden md:inline">{t('settings')}</span>
    </Button>
  );
}

/** Publishes the dock's height, so the page can leave room for it. */
function usePublishDockHeight(dock: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = dock.current;
    if (!element) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty(
        DOCK_HEIGHT_VAR,
        `${element.getBoundingClientRect().height}px`,
      );
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(DOCK_HEIGHT_VAR);
    };
  }, [dock]);
}

/**
 * The floating glass dock (DESIGN.md "Floating layers"): the YouTube square,
 * play and pause, the progress track, the transpose chip and the Settings menu.
 * Playback, progress and tools each have a dedicated row. From `sm` the
 * video spans all three rows; desktop tools have visible labels.
 */
export function PracticeDock({
  controller,
  hostRef,
  videoId,
  trackKey,
  trackTitle,
  artistText,
  viewId,
  privateTrackId,
  directAudio = false,
  expectDirectAudio = false,
  audioFallback = false,
}: {
  directAudio?: boolean;
  /** Stored audio is on its way: paint its layout before the URLs land. */
  expectDirectAudio?: boolean;
  audioFallback?: boolean;
  controller: PlaybackController | null;
  hostRef: RefObject<HTMLDivElement | null>;
  videoId: string | null;
  trackKey: TrackKey | undefined;
  trackTitle: string;
  artistText: string;
  viewId?: () => string | undefined;
  privateTrackId?: string;
}) {
  const t = useTranslations('tracks.practice.dock');
  const status = usePlaybackState((state) => state.status);
  const singing = useSinging();
  const dock = useRef<HTMLDivElement>(null);
  usePublishDockHeight(dock);
  // The layout follows expected audio before its URLs land, but the
  // waveform needs live audio: a controller without it answers every
  // snapshot with a fresh empty array, which loops the waveform's store
  // subscription instead of settling. Keep the two flags apart.
  const audioLayout = directAudio || expectDirectAudio;

  return (
    <section
      ref={dock}
      aria-label={t('label')}
      className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto grid max-w-4xl grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-2xl p-2 [grid-template-areas:'video_info''progress_progress''actions_actions'] md:gap-x-4 md:p-3 sm:[grid-template-areas:'video_info''video_progress''video_actions']"
    >
      <div
        ref={hostRef}
        data-testid={audioLayout ? undefined : 'dock-video'}
        hidden={audioLayout}
        style={{ width: YOUTUBE_SQUARE_PX, height: YOUTUBE_SQUARE_PX }}
        className="overflow-hidden rounded-lg bg-muted [grid-area:video]"
      />
      <div
        style={audioLayout ? { gridColumn: '1 / -1' } : undefined}
        data-testid="dock-track-info"
        className="flex min-w-0 items-center justify-between gap-3 [grid-area:info]"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate font-semibold text-sm md:text-base">
            {trackTitle}
          </p>
          <p className="line-clamp-2 text-muted-foreground text-xs">
            {artistText}
          </p>
          {audioFallback && (
            <p role="status" className="text-muted-foreground text-xs">
              {t('usingSavedAudio')}
            </p>
          )}
        </div>
        <DockPlayButton controller={controller} />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-1 [grid-area:actions] md:gap-3">
        <DockMicButton playback={playbackStore} />
        {audioLayout && (
          <VocalsToggle
            controller={
              audioFallback && status === 'loading' ? null : controller
            }
          />
        )}
        <StreakRing
          singing={singing}
          viewId={viewId}
          privateTrackId={privateTrackId}
        />
        <DockSettings controller={controller} videoId={videoId} />
        <TrackKeyContext value={trackKey}>
          <TransposePopover directAudio={audioLayout} />
        </TrackKeyContext>
      </div>
      <div className="flex min-w-0 [grid-area:progress]">
        {status === 'error' ? (
          <p role="alert" className="self-center text-muted-foreground text-sm">
            {t(directAudio ? 'audioError' : 'error')}
          </p>
        ) : (
          <DockProgressTrack
            controller={controller}
            waveform={directAudio ? (controller?.waveform() ?? []) : undefined}
          />
        )}
      </div>
      <DockMicNotice />
    </section>
  );
}
