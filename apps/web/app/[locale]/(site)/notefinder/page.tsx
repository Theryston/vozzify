import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import { NotefinderPageContent } from '@/features/notefinder/components/notefinder-page';
import { localeAlternates } from '@/lib/i18n/metadata';
import { socialMetadata } from '@/lib/seo/social-metadata';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notefinder');
  const locale = await getLocale();

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: localeAlternates(locale, '/notefinder'),
    ...socialMetadata({
      locale,
      path: '/notefinder',
      title: t('metaTitle'),
      description: t('metaDescription'),
    }),
  };
}

export default function NotefinderPage() {
  return <NotefinderPageContent />;
}
