import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LogoMark } from '@/components/logo-mark';
import { cn } from '@/lib/utils';
import styles from './studio-single.module.css';

export function StudioSingle({
  name,
  size,
  className,
  children,
}: {
  name: string;
  size: 'full' | 'compact';
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations('avatarIdentity');
  const full = size === 'full';
  return (
    <span
      className={cn(
        'relative inline-flex size-9 shrink-0 items-center',
        className,
        styles.frame,
      )}
      data-format={size}
    >
      <span className={styles.single} aria-hidden="true">
        <span className={styles.record}>{full && <span>{t('pro')}</span>}</span>
        <span className={styles.sleeve}>
          {children}
          {full && (
            <span className={styles.credit}>
              <span>{name}</span>
              <LogoMark />
            </span>
          )}
        </span>
      </span>
    </span>
  );
}
