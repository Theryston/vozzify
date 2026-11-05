import { z } from 'zod';

const date = z.preprocess(
  (value) => (typeof value === 'string' ? new Date(value) : value),
  z.date(),
);

export const legacyPracticeDaySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  day: z.string(),
  listenedSeconds: z.number().int(),
  completed: z.boolean(),
  completedAt: date.nullable(),
  lastHeartbeatAt: date.nullable(),
  createdAt: date,
  updatedAt: date,
});

export type LegacyPracticeDay = z.infer<typeof legacyPracticeDaySchema>;

export const legacyVisibilitySchema = z.object({
  userId: z.string().min(1),
  key: z.string(),
  value: z.enum(['PUBLIC', 'ME_ONLY']),
});

export type LegacyVisibility = z.infer<typeof legacyVisibilitySchema>;

export const importedPracticeDayValues = (day: LegacyPracticeDay) => ({
  id: day.id,
  userId: day.userId,
  day: day.day,
  listenedSeconds: day.listenedSeconds,
  completed: day.completed,
  completedAt: day.completedAt,
  lastHeartbeatAt: day.lastHeartbeatAt,
  createdAt: day.createdAt,
  updatedAt: day.updatedAt,
});
