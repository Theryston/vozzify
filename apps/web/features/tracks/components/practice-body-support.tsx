'use client';

import type { TrackDetail, TrackNotes } from '@vozzify/contracts';
import { MicOffIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useTranspose } from '../stores/transpose-store';
import { transposeNotes } from '../transpose/transpose';

export function NoVoice() {
  const t = useTranslations('tracks.practice.noVoice');
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-12 text-center">
      <MicOffIcon aria-hidden="true" className="size-6 text-muted-foreground" />
      <h2 className="font-semibold">{t('title')}</h2>
      <p className="max-w-md text-muted-foreground text-sm">
        {t('description')}
      </p>
    </div>
  );
}

export function useTransposedNotes(notes: TrackNotes | undefined) {
  const semitones = useTranspose();
  return useMemo(
    () => (notes ? transposeNotes(notes.notes, semitones) : []),
    [notes, semitones],
  );
}

export function durationSecondsOf(
  header: TrackDetail,
  notes: TrackNotes | undefined,
) {
  if (header.durationMs !== null) return header.durationMs / 1000;
  const last = notes?.notes.at(-1);
  return last ? last.end : 0;
}
