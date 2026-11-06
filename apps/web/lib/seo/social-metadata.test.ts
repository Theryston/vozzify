import { describe, expect, it } from 'vitest';

import { socialMetadata } from './social-metadata';

describe('social metadata', () => {
  it.each(['en', 'pt-BR'] as const)(
    'keeps page-specific copy and a localized URL in %s',
    (locale) => {
      const metadata = socialMetadata({
        locale,
        path: '/artists/queen',
        title: 'Queen: vocal notes',
        description: 'Practice Queen songs.',
      });

      expect(metadata.openGraph).toMatchObject({
        title: 'Queen: vocal notes',
        description: 'Practice Queen songs.',
        url: `/${locale}/artists/queen`,
        locale: locale === 'en' ? 'en' : 'pt_BR',
        alternateLocale: locale === 'en' ? 'pt_BR' : 'en',
        images: ['/social-card.png'],
      });
      expect(metadata.twitter).toMatchObject({
        card: 'summary_large_image',
        title: 'Queen: vocal notes',
        description: 'Practice Queen songs.',
        images: ['/social-card.png'],
      });
    },
  );

  it('uses the album cover when available', () => {
    const metadata = socialMetadata({
      locale: 'en',
      path: '/albums/opera',
      title: 'A Night at the Opera',
      description: 'Vocal notes from this album.',
      image: 'https://images.example/opera.jpg',
    });

    expect(metadata.openGraph).toMatchObject({
      images: ['https://images.example/opera.jpg'],
    });
    expect(metadata.twitter).toMatchObject({
      images: ['https://images.example/opera.jpg'],
    });
  });

  it('keeps the home canonical shape and falls back for a missing image', () => {
    expect(
      socialMetadata({
        locale: 'pt-BR',
        path: '/',
        title: 'Vozzify',
        description: 'Practice singing.',
        image: null,
      }).openGraph,
    ).toMatchObject({ url: '/pt-BR', images: ['/social-card.png'] });
  });
});
