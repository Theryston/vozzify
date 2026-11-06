import { createTranslator } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import { HomeHowItWorks, HomeIntroduction } from './home-introduction';

const { translations } = vi.hoisted(() => ({ translations: vi.fn() }));

vi.mock('next-intl/server', () => ({ getTranslations: translations }));
vi.mock('@/lib/i18n/navigation', async () => {
  const { createElement } = await import('react');
  return {
    Link: ({ href, children }: { href: string; children?: ReactNode }) =>
      createElement('a', { href }, children),
  };
});

describe('home introduction', () => {
  for (const { locale, messages } of [
    { locale: 'en', messages: en },
    { locale: 'pt-BR', messages: ptBR },
  ] as const) {
    it(`renders useful content and navigation without the feed in ${locale}`, async () => {
      const t = createTranslator({ locale, messages, namespace: 'homeSeo' });
      translations.mockResolvedValue(t);

      const intro = renderToStaticMarkup(await HomeIntroduction());
      const explanation = renderToStaticMarkup(await HomeHowItWorks());

      expect(intro).toContain('<h1');
      expect(intro).toContain(t('title'));
      expect(intro).toContain(t('description'));
      expect(intro).toContain('href="/search"');
      expect(explanation).toContain('aria-labelledby="how-it-works"');
      expect(explanation).toContain(t('howItWorksTitle'));
      expect(explanation.match(/<li /g)).toHaveLength(3);
      expect(explanation).toContain(t('steps.find.description'));
      expect(explanation).toContain(t('steps.follow.description'));
      expect(explanation).toContain(t('steps.practice.description'));
      expect(explanation).toContain('href="/plans"');
    });
  }
});
