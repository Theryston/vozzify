import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { PrivateTracksPage } from '@/features/private-tracks/components/private-tracks-page';
import { localeAlternates } from '@/lib/i18n/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('privateTracks');
  return {
    title: t('metaTitle'),
    alternates: localeAlternates(await getLocale(), '/me/tracks'),
    robots: { index: false },
  };
}

export default function MyTracksRoute() {
  return <PrivateTracksPage />;
}
