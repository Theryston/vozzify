'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { useDeletePrivateTrack } from '../hooks/use-private-tracks';

export function PrivateTrackDeleteButton({
  privateTrackId,
  userId,
  onDeleted,
}: {
  privateTrackId: string;
  userId: string;
  onDeleted?: () => void;
}) {
  const t = useTranslations('privateTracks');
  const [open, setOpen] = useState(false);
  const deletion = useDeletePrivateTrack(userId);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('delete')}
        title={t('delete')}
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden="true" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!deletion.isPending) setOpen(nextOpen);
        }}
      >
        <DialogContent closeLabel={t('cancelDelete')}>
          <DialogHeader>
            <DialogTitle>{t('confirmDeleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('confirmDeleteDescription')}
            </DialogDescription>
          </DialogHeader>
          {deletion.isError ? (
            <p role="alert" className="text-destructive text-sm">
              {t('deleteError')}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={deletion.isPending}
              onClick={() => setOpen(false)}
            >
              {t('cancelDelete')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletion.isPending}
              onClick={() =>
                deletion.mutate(privateTrackId, {
                  onSuccess: () => {
                    setOpen(false);
                    onDeleted?.();
                  },
                })
              }
            >
              {t('confirmDelete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
