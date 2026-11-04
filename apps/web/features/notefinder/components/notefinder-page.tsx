import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';

const questions = [
  'pricing',
  'why',
  'account',
  'links',
  'catalog',
  'notice',
] as const;

export async function NotefinderPageContent() {
  const t = await getTranslations('notefinder');

  return (
    <article className="mx-auto max-w-prose space-y-10 pt-8 pb-16 md:pb-24">
      <header className="space-y-4">
        <p className="font-semibold text-muted-foreground text-sm">
          {t('eyebrow')}
        </p>
        <h1 className="font-extrabold text-4xl tracking-tighter md:text-5xl">
          {t('title')}
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          {t('intro')}
        </p>
      </header>
      <div className="space-y-8">
        {questions.map((question) => (
          <section key={question} aria-labelledby={`faq-${question}`}>
            <h2 id={`faq-${question}`} className="mb-3 font-semibold text-xl">
              {t(`questions.${question}.title`)}
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              {t(`questions.${question}.answer`)}
            </p>
          </section>
        ))}
      </div>
      <Link href="/" className={buttonVariants()}>
        {t('back')}
      </Link>
    </article>
  );
}
