'use client';

import { useLocale } from 'next-intl';
import type { ReactNode } from 'react';
import { useSubscription } from '../hooks/use-billing';

/** Resolves ad eligibility from the API's paid access decision. */
export function SubscriptionAdEligibility({
  userId,
  render,
}: {
  userId: string;
  render: (eligible: boolean) => ReactNode;
}) {
  const locale = useLocale();
  const subscription = useSubscription(userId, locale);
  const eligible =
    !subscription.isPending &&
    !subscription.isError &&
    subscription.data !== undefined &&
    subscription.data.subscription?.paidMembership !== true;
  return render(eligible);
}
