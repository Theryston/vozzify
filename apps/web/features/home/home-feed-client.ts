import { homeFeedPageSchema, type Locale } from '@vozzify/contracts';

import { browserApi } from '@/lib/api/browser';
import {
  HomeVisitRestartError,
  isExpiredHomeVisitError,
} from './home-visit-restart';

/** One request for a page of rows: the locale and the cursor to resume from. */
export type HomePageRequest = {
  locale: Locale;
  cursor: string | undefined;
  signal: AbortSignal;
};

/**
 * Fetches a page of rows straight from the API. Loaded on the first scroll
 * (`import()` in the query), so the schema's Zod stays out of the page's
 * first-load JavaScript.
 */
export async function fetchHomePageInBrowser({
  locale,
  cursor,
  signal,
}: HomePageRequest) {
  try {
    return await browserApi('/home', {
      schema: homeFeedPageSchema,
      query: { locale, cursor },
      signal,
    });
  } catch (error) {
    if (!cursor || !isExpiredHomeVisitError(error)) throw error;
    const firstPage = await browserApi('/home', {
      schema: homeFeedPageSchema,
      query: { locale, cursor: undefined },
      signal,
    });
    throw new HomeVisitRestartError(firstPage);
  }
}
