import type { TrackProcessing, TrackProcessingStep } from '@vozzify/contracts';
import { CheckIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

import { type StepState, type StepView, stepStates } from '../processing-steps';

/** Each state's pill on the orange banner (DESIGN.md "Featured blocks"). */
const PILL_CLASS: Record<StepState, string> = {
  done: 'bg-black/15',
  current: 'bg-primary-foreground text-primary',
  failed: 'bg-black/40',
  pending: 'border border-primary-foreground/50',
};

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') {
    return <CheckIcon aria-hidden="true" className="size-4" />;
  }
  if (state === 'current') {
    return <Spinner aria-hidden="true" className="size-4" />;
  }
  if (state === 'failed') {
    return <XIcon aria-hidden="true" className="size-4" />;
  }
  return null;
}

/**
 * One step as a pill: a short visible name, and for screen readers the full
 * one with its state, since the pill's look alone carries the state.
 */
function StepPill({ step, state }: StepView) {
  const t = useTranslations('tracks.processing.steps');
  return (
    <li
      data-state={state}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-full px-3.5 font-semibold text-sm',
        PILL_CLASS[state],
      )}
    >
      <StepIcon state={state} />
      <span aria-hidden="true">{t(`short.${step}`)}</span>
      <span className="sr-only">{t(step)}</span>
      <span className="sr-only">{t(`state.${state}`)}</span>
    </li>
  );
}

/** The steps of a Processing as a row of pills, in run order. */
export function TrackProcessingSteps({
  processing,
  stages,
}: {
  processing: Pick<TrackProcessing, 'status' | 'resumeFrom'>;
  stages?: readonly TrackProcessingStep[];
}) {
  const t = useTranslations('tracks.processing.steps');
  const steps = stepStates(processing.status, processing.resumeFrom, stages);
  return (
    <ol aria-label={t('label')} className="flex flex-wrap gap-2">
      {steps.map((view) => (
        <StepPill key={view.step} step={view.step} state={view.state} />
      ))}
    </ol>
  );
}
