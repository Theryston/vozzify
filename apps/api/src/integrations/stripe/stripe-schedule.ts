import { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';
import type { StripeSubscription } from './stripe-billing-schemas.js';

export type ScheduleInput = {
  id: string;
  subscription: string;
  schedule: string | null;
  currentPrice: string;
  nextPrice: string;
  nextCycle: 'monthly' | 'annual';
  previousPrice: string | null;
  previousCycle: 'monthly' | 'annual' | null;
  start: number;
  end: number;
  trialEnd?: number;
  currentCycle?: 'monthly' | 'annual';
};
export function scheduleForProvider(
  input: ScheduleInput,
  provider: StripeSubscription,
): ScheduleInput {
  return provider.status === 'trialing' && provider.trial_end
    ? { ...input, trialEnd: provider.trial_end }
    : input;
}
export function schedulePhases(input: ScheduleInput) {
  return {
    end_behavior: 'release',
    proration_behavior: 'none',
    'phases[0][start_date]': String(input.start),
    'phases[0][end_date]': String(input.end),
    'phases[0][items][0][price]': input.currentPrice,
    'phases[0][items][0][quantity]': '1',
    'phases[0][proration_behavior]': 'none',
    ...(input.trialEnd
      ? { 'phases[0][trial_end]': String(input.trialEnd) }
      : {}),
    'phases[1][start_date]': String(input.end),
    'phases[1][items][0][price]': input.nextPrice,
    'phases[1][items][0][quantity]': '1',
    'phases[1][proration_behavior]': 'none',
    'phases[1][iterations]': '1',
  };
}

const scheduleSchema = z.object({
  id: z.string(),
  livemode: z.boolean(),
  subscription: z.string(),
  status: z.literal('active'),
  end_behavior: z.literal('release').optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  phases: z
    .array(
      z
        .object({
          start_date: z.number(),
          end_date: z.number(),
          items: z.array(
            z.object({ price: z.string(), quantity: z.number() }).passthrough(),
          ),
        })
        .passthrough(),
    )
    .min(1),
});
function emptySetting(value: unknown): boolean {
  return (
    value == null ||
    value === false ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value).every(emptySetting))
  );
}
function safePhase(
  phase: z.infer<typeof scheduleSchema>['phases'][number],
  trialEnd?: number,
) {
  const ignored = new Set([
    'start_date',
    'end_date',
    'items',
    'currency',
    'proration_behavior',
    'trial_end',
    'trial',
  ]);
  const safe = Object.entries(phase).every(
    ([key, value]) => ignored.has(key) || emptySetting(value),
  );
  const item = phase.items[0];
  return (
    safe &&
    (phase.trial == null ||
      phase.trial === false ||
      (phase.trial === true && trialEnd !== undefined)) &&
    (trialEnd ? phase.trial_end === trialEnd : emptySetting(phase.trial_end)) &&
    phase.items.length === 1 &&
    item &&
    item.quantity === 1 &&
    Object.entries(item).every(
      ([key, value]) =>
        key === 'price' ||
        key === 'quantity' ||
        (key === 'plan' && value === item.price) ||
        emptySetting(value),
    )
  );
}
function phaseEnd(start: number, cycle: 'monthly' | 'annual') {
  const original = new Date(start * 1000);
  const target = new Date(original);
  const day = target.getUTCDate();
  target.setUTCDate(1);
  if (cycle === 'annual') target.setUTCFullYear(target.getUTCFullYear() + 1);
  else target.setUTCMonth(target.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return Math.floor(target.getTime() / 1000);
}

function safeFuture(
  phase: z.infer<typeof scheduleSchema>['phases'][number],
  input: ScheduleInput,
) {
  const price = phase.items[0]?.price;
  const allowed = [input.previousPrice, input.nextPrice];
  if (input.trialEnd && !input.previousPrice) allowed.push(input.currentPrice);
  const cycle =
    price === input.currentPrice && input.trialEnd
      ? (input.currentCycle ?? input.nextCycle)
      : price === input.nextPrice
        ? input.nextCycle
        : (input.previousCycle ?? input.nextCycle);
  return (
    safePhase(phase) &&
    phase.start_date === input.end &&
    allowed.includes(price ?? null) &&
    phase.end_date === phaseEnd(input.end, cycle)
  );
}

export function validateSchedule(
  raw: unknown,
  input: ScheduleInput,
  scheduleId: string,
  requireFuture = false,
) {
  const schedule = scheduleSchema.safeParse(raw);
  const phases = schedule.success ? schedule.data.phases : [];
  const currentIndex = phases.findIndex(
    (phase) => phase.start_date === input.start && phase.end_date === input.end,
  );
  const current = phases[currentIndex];
  const future = phases[currentIndex + 1];
  const past = phases.slice(0, currentIndex);
  if (
    !schedule.success ||
    schedule.data.id !== scheduleId ||
    (schedule.data.metadata &&
      Object.keys(schedule.data.metadata).length > 0) ||
    schedule.data.subscription !== input.subscription ||
    currentIndex < 0 ||
    past.some(
      (phase) =>
        phase.end_date > input.start || phase.start_date >= phase.end_date,
    ) ||
    phases.length > currentIndex + 2 ||
    !current ||
    !safePhase(current, input.trialEnd) ||
    current.start_date !== input.start ||
    current.end_date !== input.end ||
    current.items[0]?.price !== input.currentPrice ||
    (requireFuture && future?.items[0]?.price !== input.nextPrice) ||
    (future && !safeFuture(future, input))
  )
    throw new AppException(
      'CONFLICT',
      'Stripe schedule contains unrecognised terms',
    );
  return future?.items[0]?.price ?? null;
}
