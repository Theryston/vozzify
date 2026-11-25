import { useTranslations } from 'next-intl';

import { clockMessage } from '../playback/clock-message';

/** The length as a clock, with hours for tracks of at least an hour. */
export function TrackDuration({ ms }: { ms: number }) {
  const t = useTranslations('tracks.practice');
  const { key, values: parts } = clockMessage(ms / 1000);
  const text = t(key, parts);

  return (
    <>
      <span className="sr-only">{t('durationLabel', { duration: text })}</span>
      <time
        aria-hidden="true"
        className="shrink-0 font-mono tabular-nums"
        dateTime={`PT${parts.hours}H${parts.minutes}M${parts.seconds}S`}
      >
        {text}
      </time>
    </>
  );
}
