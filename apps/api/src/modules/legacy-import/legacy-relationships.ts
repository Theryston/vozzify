import { z } from 'zod';

const date = z.preprocess(
  (value) => (typeof value === 'string' ? new Date(value) : value),
  z.date(),
);

export const legacyFavoriteSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  trackId: z.string().min(1),
  createdAt: date,
  updatedAt: date,
});

export type LegacyFavorite = z.infer<typeof legacyFavoriteSchema>;

export const legacyViewSchema = z.object({
  id: z.string().min(1),
  trackId: z.string().min(1),
  userId: z.string().min(1).nullable(),
  createdAt: date,
  updatedAt: date,
});

export type LegacyView = z.infer<typeof legacyViewSchema>;
