'use client';
import { useQuery } from '@tanstack/react-query';
import { billingKeys } from '../query-keys';

export function useSubscription(userId: string, locale: string) {
  return useQuery({
    queryKey: billingKeys.subscription(userId, locale),
    queryFn: async () => {
      const [{ browserApi }, { currentSubscriptionSchema }] = await Promise.all(
        [import('@/lib/api/browser'), import('@vozzify/contracts')],
      );
      return browserApi('/me/subscription', {
        schema: currentSubscriptionSchema,
        query: { locale },
      });
    },
    // The account Avatar uses this query even away from the billing page.
    refetchInterval: (query) =>
      query.state.data?.subscription?.status === 'pending' ? 5000 : 60_000,
  });
}
