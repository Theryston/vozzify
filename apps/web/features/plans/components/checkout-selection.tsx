'use client';

import type {
  BillingCycle,
  Plan,
  PlanCurrency,
  PlanOffer,
} from '@vozzify/contracts';
import { ArrowRightIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SessionUserBoundary } from '@/features/auth/components/session-user';
import { useRouter } from '@/lib/i18n/navigation';
import { useCheckout } from '../hooks/use-checkout';
import { useTrialEligibility } from '../hooks/use-trial-eligibility';
import { selectedPlanOffer } from '../plan-pricing';
import { PlanCycleOptions } from './plan-cycle-options';
import { PlanPrice } from './plan-price';
import { TrialDisclosure } from './trial-disclosure';

type CheckoutPlan = Pick<
  Plan,
  'id' | 'name' | 'offers' | 'saleAvailable' | 'trialDays'
>;
type Props = { plan: CheckoutPlan; currency: PlanCurrency };
type SelectionProps = Props & {
  loading: boolean;
  signedIn: boolean;
  userId: string | undefined;
  ready: boolean;
};

export function CheckoutSelection({ plan, currency }: Props) {
  return (
    <SessionUserBoundary
      render={(user, loading) => (
        <UserCheckoutSelection
          plan={plan}
          currency={currency}
          loading={loading}
          signedIn={Boolean(user)}
          userId={user?.id}
          ready={Boolean(user?.emailVerified && user.username)}
        />
      )}
    />
  );
}

function UserCheckoutSelection(props: SelectionProps) {
  const t = useTranslations('plans');
  const billing = useTranslations('billing');
  const eligibility = useTrialEligibility(
    props.userId,
    props.signedIn && props.ready && props.plan.trialDays > 0,
  );
  const days = props.signedIn
    ? eligibility.data?.eligible
      ? props.plan.trialDays
      : 0
    : props.plan.trialDays;
  const selection = usePlanSelection({
    ...props,
    trialDays: days,
    eligibilityLoading:
      props.signedIn && props.plan.trialDays > 0 && !eligibility.data,
  });
  if (!selection.offer)
    return <p className="text-muted-foreground text-sm">{t('noOffers')}</p>;
  return (
    <div className="space-y-5">
      {days > 0 ? (
        <span className="inline-flex rounded-full bg-muted px-3 py-1 font-semibold text-foreground text-sm">
          {t('trialBadge', { days })}
        </span>
      ) : null}
      <PlanPrice offer={selection.offer} currency={props.currency} />
      <TrialDisclosure
        offered={props.plan.trialDays}
        days={days}
        visible={!props.signedIn || Boolean(eligibility.data)}
      />
      {eligibility.isError ? (
        <p role="alert">{billing('checkoutError')}</p>
      ) : null}
      <PlanCycleOptions
        planId={props.plan.id}
        offers={props.plan.offers}
        selected={selection.offer}
        currency={props.currency}
        disabled={selection.busy}
        onChange={selection.setCycle}
      />
      <CheckoutAction
        plan={props.plan}
        trialDays={days}
        busy={selection.busy}
        disabled={selection.disabled}
        onClick={selection.choose}
      />
      {selection.failed || selection.unavailable ? (
        <p role="alert" className="text-sm">
          {billing(selection.unavailable ? 'unavailable' : 'checkoutError')}
        </p>
      ) : null}
    </div>
  );
}

function usePlanSelection(
  props: SelectionProps & { trialDays: number; eligibilityLoading: boolean },
) {
  const { plan, loading, signedIn, ready } = props;
  const search = useSearchParams();
  const selectedCycle =
    search.get('plan') === plan.id && search.get('cycle') === 'annual'
      ? 'annual'
      : 'monthly';
  const [cycle, setCycle] = useState<BillingCycle>(selectedCycle);
  const router = useRouter();
  const checkout = useCheckout(plan.id);
  const offer = selectedPlanOffer(plan.offers, cycle);
  const resume = useResumeCheckout({
    ...props,
    loading: props.loading || props.eligibilityLoading,
    start: (offer) => checkout.mutate({ offer, trialDays: props.trialDays }),
    select: setCycle,
  });
  function choose() {
    if (!offer || checkout.isPending || plan.saleAvailable !== true) return;
    if (!signedIn) {
      const query = new URLSearchParams({
        plan: plan.id,
        cycle: offer.cycle,
        offer: offer.id,
      });
      router.push({
        pathname: '/sign-in',
        query: { redirectTo: `/plans?${query}` },
      });
    } else if (ready && !props.eligibilityLoading)
      checkout.mutate({ offer, trialDays: props.trialDays });
  }
  return {
    offer,
    setCycle,
    choose,
    busy: checkout.isPending,
    disabled:
      loading ||
      checkout.isPending ||
      props.eligibilityLoading ||
      (signedIn && !ready),
    failed: checkout.isError,
    unavailable: resume.unavailable,
  };
}

function CheckoutAction({
  plan,
  trialDays,
  busy,
  disabled,
  onClick,
}: {
  plan: CheckoutPlan;
  trialDays: number;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const t = useTranslations('plans');
  const billing = useTranslations('billing');
  if (plan.saleAvailable !== true)
    return (
      <p className="rounded-full bg-muted px-4 py-3 text-center text-muted-foreground text-sm">
        {t(plan.saleAvailable === false ? 'salesPaused' : 'checkoutPending')}
      </p>
    );
  return (
    <Button size="lg" className="w-full" disabled={disabled} onClick={onClick}>
      {busy
        ? billing('redirecting')
        : trialDays > 0
          ? t('tryFree')
          : t('choosePlan', { plan: plan.name })}
      {!busy ? <ArrowRightIcon aria-hidden /> : null}
    </Button>
  );
}

function useResumeCheckout({
  plan,
  loading,
  ready,
  start,
  select,
}: SelectionProps & {
  start: (offer: PlanOffer) => void;
  select: (cycle: BillingCycle) => void;
}) {
  const search = useSearchParams();
  const router = useRouter();
  const attempted = useRef(false);
  const selected = search.get('plan') === plan.id;
  const offer = plan.offers.find(
    (item) =>
      item.id === search.get('offer') && item.cycle === search.get('cycle'),
  );
  // An authenticated return resumes only a currently offered, purchasable selection.
  useEffect(() => {
    if (
      loading ||
      !ready ||
      !selected ||
      !offer ||
      plan.trialDays > 0 ||
      attempted.current ||
      plan.saleAvailable !== true
    )
      return;
    attempted.current = true;
    select(offer.cycle);
    const query = new URLSearchParams(search);
    for (const key of ['plan', 'cycle', 'offer']) query.delete(key);
    router.replace(
      { pathname: '/plans', query: Object.fromEntries(query) },
      { scroll: false },
    );
    start(offer);
  }, [
    loading,
    ready,
    selected,
    offer,
    start,
    select,
    router,
    search,
    plan.saleAvailable,
    plan.trialDays,
  ]);
  return { unavailable: selected && !offer };
}
