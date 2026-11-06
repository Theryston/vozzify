import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';

const steps = ['find', 'follow', 'practice'] as const;

export async function HomeIntroduction() {
  const t = await getTranslations('homeSeo');

  return (
    <header className="max-w-3xl space-y-4 pt-4 md:pt-6">
      <h1 className="font-extrabold text-4xl tracking-tight md:text-5xl">
        {t('title')}
      </h1>
      <p className="text-lg text-muted-foreground leading-relaxed">
        {t('description')}
      </p>
      <Link href="/search" className={buttonVariants()}>
        {t('browseSongs')}
      </Link>
    </header>
  );
}

export async function HomeHowItWorks() {
  const t = await getTranslations('homeSeo');

  return (
    <section aria-labelledby="how-it-works" className="space-y-6 py-8">
      <h2 id="how-it-works" className="font-bold text-2xl tracking-tight">
        {t('howItWorksTitle')}
      </h2>
      <ol className="grid gap-6 md:grid-cols-3">
        {steps.map((step) => (
          <li key={step} className="space-y-2">
            <h3 className="font-semibold text-lg">
              {t(`steps.${step}.title`)}
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              {t(`steps.${step}.description`)}
            </p>
          </li>
        ))}
      </ol>
      <Link href="/plans" className={buttonVariants({ variant: 'outline' })}>
        {t('plans')}
      </Link>
    </section>
  );
}
