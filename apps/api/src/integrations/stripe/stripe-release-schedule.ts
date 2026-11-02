import { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';
import { type ScheduleInput, validateSchedule } from './stripe-schedule.js';

type Request = (
  path: string,
  body?: Record<string, string>,
  key?: string,
) => Promise<unknown>;

export async function releaseSchedule(
  input: ScheduleInput,
  schedule: string | null | undefined,
  request: Request,
) {
  // A missing attachment also confirms a release whose response was lost.
  if (!schedule) return;
  const path = `subscription_schedules/${encodeURIComponent(schedule)}`;
  validateSchedule(await request(path), input, schedule);
  const result = z
    .object({
      id: z.literal(schedule),
      livemode: z.boolean(),
      status: z.literal('released'),
      released_subscription: z.literal(input.subscription),
    })
    .safeParse(await request(`${path}/release`, {}, `release-${input.id}`));
  if (!result.success)
    throw new AppException(
      'CONFLICT',
      'Subscription schedule release is unconfirmed',
    );
}
