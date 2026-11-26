'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useRetryPrivateTrack } from '../hooks/use-private-tracks';

export function PrivateTrackRetryButton({
  privateTrackId,
  userId,
}: {
  privateTrackId: string;
  userId: string;
}) {
  const t = useTranslations();
  const retry = useRetryPrivateTrack(userId, privateTrackId);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
      >
        {t('tracks.processing.retry.action')}
      </Button>
      {retry.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {t('privateTracks.detail.retryError')}
        </p>
      ) : null}
    </div>
  );
}
