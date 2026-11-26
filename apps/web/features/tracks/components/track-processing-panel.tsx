import { useTranslations } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';

import { TrackProcessingBanner } from './track-processing-banner';
import { TrackProcessingStatus } from './track-processing-status';

export function TrackProcessingPanel({
  statusOptions,
  aside,
  ...banner
}: ComponentProps<typeof TrackProcessingBanner> & {
  statusOptions?: Omit<ComponentProps<typeof TrackProcessingStatus>, 'status'>;
  aside?: ReactNode;
}) {
  const t = useTranslations('tracks.processing');

  return (
    <div className="flex flex-col gap-10 pb-6 md:gap-12 md:pb-8">
      <TrackProcessingBanner {...banner} />
      <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] md:gap-12">
        {banner.processing === null ? (
          <p className="text-muted-foreground text-sm">{t('none')}</p>
        ) : (
          <TrackProcessingStatus
            status={banner.processing.status}
            {...statusOptions}
          />
        )}
        {aside}
      </div>
    </div>
  );
}
