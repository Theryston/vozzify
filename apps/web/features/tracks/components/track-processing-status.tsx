import type {
  TrackProcessingStatus as ProcessingStatus,
  TrackProcessingFailureCode,
} from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { remainingMinutes } from '../processing-steps';

const TITLE_CLASS = 'font-bold text-2xl tracking-tight';
const TEXT_CLASS = 'max-w-prose text-muted-foreground text-sm';

type Failure = { code: TrackProcessingFailureCode | null; action?: ReactNode };

/** Why the Processing failed and, when a retry can fix it, "Try again". */
function FailedStatus({ failure }: { failure?: Failure }) {
  const t = useTranslations('tracks.processing');
  return (
    <>
      <h2 className={TITLE_CLASS}>{t('failed.title')}</h2>
      <p className={TEXT_CLASS}>
        {t(`failed.reason.${failure?.code ?? 'INTERNAL'}`)}
      </p>
      {failure?.action ? <div className="pt-2">{failure.action}</div> : null}
    </>
  );
}

/**
 * What happens now, under the banner: the running step with what it does and
 * about how long is left, the wait while queued, or the failure. A completed
 * Processing never gets here (the page shows only a line then).
 */
export function TrackProcessingStatus({
  status,
  elapsedMs,
  failure,
  copy,
}: {
  status: ProcessingStatus;
  elapsedMs?: number;
  failure?: Failure;
  copy?: { activeTitle: string; closeNote: string };
}) {
  const t = useTranslations('tracks.processing');
  if (status === 'COMPLETED') return null;

  const closeNote = (
    <p className={TEXT_CLASS}>{copy?.closeNote ?? t('closeNote')}</p>
  );
  let body: ReactNode;
  if (status === 'FAILED') {
    body = <FailedStatus failure={failure} />;
  } else if (status === 'QUEUED') {
    body = (
      <>
        <h2 className={TITLE_CLASS}>{t('queued.title')}</h2>
        {closeNote}
      </>
    );
  } else {
    body = (
      <>
        <h2 className={TITLE_CLASS}>
          {copy?.activeTitle ?? t(`steps.${status}`)}
        </h2>
        <p className={TEXT_CLASS}>{t(`steps.description.${status}`)}</p>
        {elapsedMs === undefined ? null : (
          <p className="font-medium text-sm tabular-nums">
            {t('remaining', {
              minutes: remainingMinutes(status, elapsedMs) ?? 0,
            })}
          </p>
        )}
        {closeNote}
      </>
    );
  }
  return (
    <section role="status" className="flex flex-col gap-2">
      {body}
    </section>
  );
}
