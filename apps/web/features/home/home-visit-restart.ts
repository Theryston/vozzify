import type { HomeFeedPage } from '@vozzify/contracts';
import { isApiError } from '@/lib/api/api-error';

/** Carries a fresh page so an expired infinite query can be reset atomically. */
export class HomeVisitRestartError extends Error {
  constructor(readonly firstPage: HomeFeedPage) {
    super('The Home visit expired and was restarted');
    this.name = 'HomeVisitRestartError';
  }
}

export const isExpiredHomeVisitError = (error: unknown): boolean => {
  if (!isApiError(error) || error.code !== 'NOT_FOUND') return false;
  if (typeof error.details !== 'object' || error.details === null) return false;
  return (
    'reason' in error.details && error.details.reason === 'FEED_VERSION_EXPIRED'
  );
};

export const isHomeVisitRestartError = (
  error: unknown,
): error is HomeVisitRestartError => error instanceof HomeVisitRestartError;
