import type { HomeFeedPage, Locale } from '@vozzify/contracts';

/** Keys of the home's client queries; one feed per locale. */
export const homeQueryKeys = {
  rows: (locale: Locale, page: Pick<HomeFeedPage, 'audience' | 'version'>) =>
    ['home', 'rows', locale, page.audience, page.version] as const,
};
