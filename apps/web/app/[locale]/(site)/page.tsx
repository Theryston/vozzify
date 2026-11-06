import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { HomeFeed } from '@/features/home/components/home-feed';
import { HomeFeedSkeleton } from '@/features/home/components/home-feed-skeleton';
import {
  HomeHowItWorks,
  HomeIntroduction,
} from '@/features/home/components/home-introduction';
import { HomeStructuredData } from '@/features/home/components/home-structured-data';
import { localeAlternates } from '@/lib/i18n/metadata';
import { socialMetadata } from '@/lib/seo/social-metadata';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations('metadata');
  return {
    alternates: localeAlternates(locale, '/'),
    ...socialMetadata({
      locale,
      path: '/',
      title: t('title'),
      description: t('description'),
    }),
  };
}

export default function HomePage() {
  return (
    <div className="space-y-8">
      <HomeStructuredData />
      <HomeIntroduction />
      <Suspense fallback={<HomeFeedSkeleton />}>
        <HomeFeed />
      </Suspense>
      <HomeHowItWorks />
    </div>
  );
}
