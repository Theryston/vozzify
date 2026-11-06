import type { TrackNotes } from '@vozzify/contracts';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import english from '../../../messages/en.json';
import portuguese from '../../../messages/pt-BR.json';
import { TrackNoteSummary } from './track-note-summary';

const notes: TrackNotes = {
  notes: [
    { pitch: 72, start: 0, end: 1 },
    { pitch: 48, start: 1, end: 2 },
    { pitch: 60, start: 2, end: 3 },
  ],
};

const locales = [
  { locale: 'en', messages: english },
  { locale: 'pt-BR', messages: portuguese },
] as const;

function renderSummary(
  current: (typeof locales)[number],
  trackNotes: TrackNotes | undefined,
) {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      ...current,
      // biome-ignore lint/correctness/noChildrenProp: this test builds elements without JSX
      children: createElement(TrackNoteSummary, { notes: trackNotes }),
    }),
  );
}

describe('TrackNoteSummary', () => {
  for (const current of locales) {
    it(`renders the original vocal range and practice instructions in ${current.locale}`, () => {
      const t = createTranslator({
        ...current,
        namespace: 'tracks.practice.noteSummary',
      });
      const markup = renderSummary(current, notes);

      expect(markup).toContain('aria-labelledby="track-vocal-range"');
      expect(markup).toContain(`<h2`);
      expect(markup).toContain(t('title'));
      expect(markup).toContain(t('range', { low: 'C3', high: 'C5' }));
      expect(markup).toContain(t('practice'));
    });

    it(`renders no invented range when notes are empty or unavailable in ${current.locale}`, () => {
      expect(renderSummary(current, undefined)).toBe('');
      expect(renderSummary(current, { notes: [] })).toBe('');
    });
  }
});
