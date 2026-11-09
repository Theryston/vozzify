import {
  homeFeedPageSchema,
  homeRowItemsPageSchema,
  type Locale,
} from '@vozzify/contracts';
import { browserApi } from '@/lib/api/browser';
import {
  HomeVisitRestartError,
  isExpiredHomeVisitError,
} from './home-visit-restart';

export async function fetchHomeRowItemsPage({
  rowId,
  cursor,
  locale,
  signal,
}: {
  rowId: string;
  cursor: string;
  locale: Locale;
  signal: AbortSignal;
}) {
  try {
    return await browserApi(`/home/rows/${encodeURIComponent(rowId)}/items`, {
      schema: homeRowItemsPageSchema,
      query: { cursor },
      signal,
    });
  } catch (error) {
    if (!isExpiredHomeVisitError(error)) throw error;
    const firstPage = await browserApi('/home', {
      schema: homeFeedPageSchema,
      query: { locale },
      headers: { 'Cache-Control': 'no-cache' },
      signal,
    });
    throw new HomeVisitRestartError(firstPage);
  }
}
