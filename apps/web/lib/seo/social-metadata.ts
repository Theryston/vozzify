import type { Metadata } from 'next';

import type { Locale } from '@/lib/i18n/routing';

type SocialMetadataOptions = {
  locale: Locale;
  path: string;
  title: string;
  description: string;
  image?: string | null;
};

/** Set each page's social copy together so it never inherits the home title. */
export function socialMetadata({
  locale,
  path,
  title,
  description,
  image,
}: SocialMetadataOptions): Pick<Metadata, 'openGraph' | 'twitter'> {
  const images = [image ?? '/social-card.png'];
  return {
    openGraph: {
      type: 'website',
      siteName: 'Vozzify',
      locale: locale.replace('-', '_'),
      alternateLocale: locale === 'en' ? 'pt_BR' : 'en',
      url: `/${locale}${path === '/' ? '' : path}`,
      title,
      description,
      images,
    },
    twitter: { card: 'summary_large_image', title, description, images },
  };
}
