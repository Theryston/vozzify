import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import { NotefinderPageContent } from '@/features/notefinder/components/notefinder-page';
import { localeAlternates } from '@/lib/i18n/metadata';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notefinder');

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: localeAlternates(await getLocale(), '/notefinder'),
  };
}

export default function NotefinderPage() {
  return <NotefinderPageContent />;
}
