import type { TrackNotes } from '@vozzify/contracts';
import { useTranslations } from 'next-intl';

import { noteRangeOf } from '../note-summary';

/** Original pitches stay explicit when the singer transposes the timeline. */
export function TrackNoteSummary({ notes }: { notes: TrackNotes | undefined }) {
  const t = useTranslations('tracks.practice.noteSummary');
  const range = noteRangeOf(notes?.notes ?? []);
  if (range === null) return null;

  return (
    <section aria-labelledby="track-vocal-range" className="space-y-1">
      <h2 id="track-vocal-range" className="font-semibold text-sm">
        {t('title')}
      </h2>
      <p className="text-muted-foreground text-sm">{t('range', range)}</p>
      <p className="text-muted-foreground text-sm">{t('practice')}</p>
    </section>
  );
}
