'use client';

import {
  ArrowRightIcon,
  AudioLinesIcon,
  MicIcon,
  Music2Icon,
} from 'lucide-react';
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

const benefits = [
  { message: 'proNotes', Icon: Music2Icon },
  { message: 'proVocals', Icon: AudioLinesIcon },
  { message: 'proPitch', Icon: MicIcon },
] as const;

export function ProDialog({
  open,
  trackId,
  onClose,
}: {
  open: boolean;
  trackId?: string;
  onClose: () => void;
}) {
  const t = useTranslations('privateTracks');
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent closeLabel={t('close')} className="gap-5">
        <DialogHeader className="gap-2">
          <span className="font-semibold text-primary text-xs uppercase tracking-wider">
            {t('proLabel')}
          </span>
          <DialogTitle className="font-bold text-2xl tracking-tight">
            {t('proTitle')}
          </DialogTitle>
          <DialogDescription>{t('proDescription')}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-3 border-border border-t pt-4">
          {benefits.map(({ message, Icon }) => (
            <li key={message} className="flex items-start gap-3">
              <Icon
                aria-hidden
                className="size-5 shrink-0 text-muted-foreground"
              />
              <span>{t(message)}</span>
            </li>
          ))}
        </ul>
        <Link
          className={buttonVariants({ size: 'lg' })}
          href="/plans"
          onClick={onClose}
        >
          {t('viewPlans')}
          <ArrowRightIcon aria-hidden data-icon="inline-end" />
        </Link>
        {trackId && (
          <Link
            href={`/tracks/${encodeURIComponent(trackId)}`}
            className={buttonVariants({ variant: 'ghost' })}
            onClick={onClose}
          >
            {t('manageTrack')}
          </Link>
        )}
      </DialogContent>
    </Dialog>
  );
}
