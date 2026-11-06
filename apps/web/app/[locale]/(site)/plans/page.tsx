import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getLocale, getTranslations } from 'next-intl/server';

import { PlanComparison } from '@/features/plans/components/plan-comparison';
import { getPlanCatalog } from '@/features/plans/queries';
import { localeAlternates } from '@/lib/i18n/metadata';
import { socialMetadata } from '@/lib/seo/social-metadata';

// Catalog-controlled copy and benefit counts have no fixed placeholder geometry.
// Wait for the actual comparison so its first paint already has its final layout.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('plans');
  const locale = await getLocale();
  return {
    title: t('metaTitle'),
    description: t('description'),
    alternates: localeAlternates(locale, '/plans'),
    ...socialMetadata({
      locale,
      path: '/plans',
      title: t('metaTitle'),
      description: t('description'),
    }),
  };
}

export default async function PlansPage() {
  await connection();
  const [t, locale] = await Promise.all([
    getTranslations('plans'),
    getLocale(),
  ]);
  const catalog = await getPlanCatalog(locale).catch(() => null);
  return (
    <div className="space-y-7 pt-4 md:pt-6">
      <header className="max-w-2xl space-y-2">
        <h1 className="font-extrabold text-4xl tracking-tight">{t('title')}</h1>
        <p className="text-base text-muted-foreground">{t('intro')}</p>
      </header>
      <PlanComparison locale={locale} catalog={catalog} />
    </div>
  );
}
