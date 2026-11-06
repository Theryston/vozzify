import { getTranslations } from 'next-intl/server';

import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';

/**
 * Unknown URL under a locale: a real 404 with a translated explanation and two
 * recovery links. Canonical and hreflang are left out on purpose: a 404 must
 * not advertise an indexable URL.
 */
export async function NotFoundPage() {
  const t = await getTranslations('notFound');

  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center md:py-24">
      <h1 className="flex flex-col items-center gap-3 font-extrabold text-4xl tracking-tight">
        <span className="font-mono font-semibold text-muted-foreground text-xs uppercase tracking-wider">
          404
        </span>
        <span>{t('title')}</span>
      </h1>
      <p className="max-w-prose text-muted-foreground">{t('description')}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className={buttonVariants()}>
          {t('homeLabel')}
        </Link>
        <Link
          href="/search"
          className={buttonVariants({ variant: 'secondary' })}
        >
          {t('searchLabel')}
        </Link>
      </div>
    </div>
  );
}
