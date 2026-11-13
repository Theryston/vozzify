'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { AdsenseConfig } from '@/lib/env/adsense-config';
import { requestInFeedAd } from '../ad-runtime';
import { useAdPermission } from './advertising-provider';

export function HomeInFeedAd({ config }: { config?: AdsenseConfig }) {
  const permitted = useAdPermission();
  const t = useTranslations('advertising');
  const slotRef = useRef<HTMLModElement>(null);
  const [status, setStatus] = useState<'loading' | 'filled' | 'unfilled'>(
    'loading',
  );

  useEffect(() => {
    if (!permitted || !config) return;
    const slot = slotRef.current;
    if (!slot) return;
    const observer = new MutationObserver(() => {
      setStatus(slot.dataset.adStatus === 'filled' ? 'filled' : 'unfilled');
    });
    observer.observe(slot, {
      attributes: true,
      attributeFilter: ['data-ad-status'],
    });
    if (slot.dataset.adStatus) return () => observer.disconnect();
    try {
      requestInFeedAd();
    } catch {
      setStatus('unfilled');
    }
    return () => observer.disconnect();
  }, [config, permitted]);

  if (!permitted || !config || status === 'unfilled') return null;
  return (
    <aside
      aria-label={t('label')}
      className={
        status === 'filled'
          ? 'mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8'
          : 'invisible absolute top-0 left-0 w-full'
      }
      aria-hidden={status !== 'filled'}
      data-testid="home-in-feed-ad"
    >
      {status === 'filled' ? (
        <p className="mb-2 font-medium text-muted-foreground text-xs">
          {t('label')}
        </p>
      ) : null}
      <ins
        ref={slotRef}
        className="adsbygoogle block w-full overflow-hidden rounded-2xl bg-surface"
        style={{ display: 'block' }}
        data-ad-format="fluid"
        data-ad-layout-key={config.layoutKey}
        data-ad-client={config.client}
        data-ad-slot={config.slot}
        data-testid="adsense-slot"
      />
    </aside>
  );
}
