'use client';

import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Link } from '@/lib/i18n/navigation';

export function ProDialog({
  open,
  onPaywallOpenChange,
}: {
  open: boolean;
  onPaywallOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('privateTracks');
  return (
    <Dialog open={open} onOpenChange={onPaywallOpenChange}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('proTitle')}</DialogTitle>
          <DialogDescription>{t('proDescription')}</DialogDescription>
        </DialogHeader>
        <Link
          className={buttonVariants()}
          href="/plans"
          onClick={() => onPaywallOpenChange(false)}
        >
          {t('viewPlans')}
        </Link>
      </DialogContent>
    </Dialog>
  );
}
