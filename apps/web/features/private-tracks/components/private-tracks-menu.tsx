'use client';

import { useMutation } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRouter } from '@/lib/i18n/navigation';

const ProDialog = dynamic(() =>
  import('./private-tracks-pro-dialog').then((module) => module.ProDialog),
);

async function canOpenLibrary() {
  const [{ browserApi }, { myPrivateTracksPageSchema }] = await Promise.all([
    import('@/lib/api/browser'),
    import('@vozzify/contracts'),
  ]);
  const { canSubmit, items } = await browserApi('/me/private-tracks', {
    schema: myPrivateTracksPageSchema,
    query: { limit: 1 },
  });
  return canSubmit || items.length > 0;
}

export function usePrivateTracksMenu() {
  const router = useRouter();
  const t = useTranslations('privateTracks');
  const access = useMutation({ mutationFn: canOpenLibrary });
  const openLibrary = () => {
    if (access.isPending) return;
    access.mutate(undefined, {
      onSuccess: (allowed) => {
        if (allowed) router.push('/me/tracks');
      },
    });
  };

  let feedback = null;
  if (access.isPending) {
    feedback = (
      <span role="status" className="sr-only">
        {t('loading')}
      </span>
    );
  } else if (access.isError) {
    feedback = (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) access.reset();
        }}
      >
        <DialogContent closeLabel={t('close')}>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription role="alert">{t('loadError')}</DialogDescription>
        </DialogContent>
      </Dialog>
    );
  } else if (access.data === false) {
    feedback = <ProDialog open onClose={access.reset} />;
  }
  return { openLibrary, feedback };
}
