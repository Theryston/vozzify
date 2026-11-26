import type { TrackAudio, TrackDetail, TrackNotes } from '@vozzify/contracts';
import { useCallback, useRef, useState } from 'react';
import { durationSecondsOf } from '../components/practice-body-support';
import { useListeningTools } from '../listening/use-listening-tools';
import { useDirectAudio } from './use-direct-audio';
import { usePlayback } from './use-playback';
import { usePlaybackShortcuts } from './use-playback-shortcuts';

type PracticeControllerOptions = {
  header: TrackDetail;
  notes: TrackNotes | undefined;
  fakePlayer: boolean;
  admin: boolean;
  directAudio?: TrackAudio;
};

export function usePracticeController({
  header,
  notes,
  fakePlayer,
  admin,
  directAudio: privateAudio,
}: PracticeControllerOptions) {
  const audio = useDirectAudio(header.id, admin && privateAudio === undefined);
  const directAudio = privateAudio ?? (admin ? audio.data : undefined);
  const prefersVideo =
    privateAudio !== undefined && header.youtubeVideoId !== null;
  const [fallbackTrackId, setFallbackTrackId] = useState<string>();
  const audioFallback = prefersVideo && fallbackTrackId === header.id;
  const onAudioFallback = useCallback(
    () => setFallbackTrackId(header.id),
    [header.id],
  );
  const expectDirectAudio =
    audioFallback ||
    (!prefersVideo &&
      (privateAudio !== undefined || (admin && !audio.isError)));
  const hostRef = useRef<HTMLDivElement>(null);
  const controller = usePlayback({
    hostRef,
    videoId: directAudio
      ? (header.youtubeVideoId ?? `private-${header.id}`)
      : header.youtubeVideoId,
    durationSeconds: durationSecondsOf(header, notes),
    fake: fakePlayer,
    directAudio,
    onAudioFallback: prefersVideo ? onAudioFallback : undefined,
  });
  usePlaybackShortcuts(controller);
  useListeningTools(controller);
  return {
    controller,
    directAudio: directAudio !== undefined && (!prefersVideo || audioFallback),
    expectDirectAudio,
    audioFallback,
    hostRef,
  };
}
