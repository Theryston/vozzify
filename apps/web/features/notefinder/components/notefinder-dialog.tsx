'use client';

import { useTranslations } from 'next-intl';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Link } from '@/lib/i18n/navigation';

export function NotefinderDialog({ onDismiss }: { onDismiss: () => void }) {
  const t = useTranslations('notefinderNotice');

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription className="mt-2 leading-relaxed">
            {t('description')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Link
            href="/notefinder"
            onClick={onDismiss}
            className={buttonVariants()}
          >
            {t('learnMore')}
          </Link>
          <Button variant="ghost" onClick={onDismiss}>
            {t('dismiss')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
