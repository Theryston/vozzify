import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { NotFoundPage } from '@/components/not-found-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notFound');

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    robots: { index: false },
  };
}

export default function NotFound() {
  return <NotFoundPage />;
}
