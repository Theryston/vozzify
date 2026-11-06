import type { Locale } from '@vozzify/contracts';
import type { Database } from '../../src/database/database.js';
import { practiceAttempts } from '../../src/database/schema/practice-attempts.js';
import { trackViews } from '../../src/database/schema/track-views.js';
import { users } from '../../src/database/schema/users.js';

export const seedLocaleUsers = async (db: Database): Promise<string[]> => {
  const inserted = await db
    .insert(users)
    .values(
      Array.from({ length: 25 }, (_, index) => ({
        name: `Locale singer ${index}`,
        email: `locale-singer-${index}@example.com`,
        username: `locale_singer_${index}`,
        emailVerified: true,
      })),
    )
    .returning({ id: users.id });
  return inserted.map(({ id }) => id);
};

export const utcPracticeDay = (daysAgo: number): Date => {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysAgo,
      12,
    ),
  );
};

type LocalePracticeSeed = {
  userId: string;
  trackId: string;
  locale: Locale;
  createdAt: Date;
  forwardSkip?: boolean;
  bleedSuspected?: boolean;
  linked?: boolean;
};

/** Views share today's date, so active days must come from the Attempts. */
export const seedLocalePractice = async (
  db: Database,
  seeds: LocalePracticeSeed[],
): Promise<void> => {
  const views = await db
    .insert(trackViews)
    .values(
      seeds.map(({ userId, trackId, locale }) => ({ userId, trackId, locale })),
    )
    .returning({ id: trackViews.id });
  await db.insert(practiceAttempts).values(
    seeds.map((seed, index) => {
      const view = views[index];
      if (!view) throw new Error('Missing locale fixture View');
      return {
        userId: seed.userId,
        trackId: seed.trackId,
        viewId: seed.linked === false ? null : view.id,
        difficulty: 'NORMAL' as const,
        octaveMode: 'ANY' as const,
        transposeSemitones: 0,
        speed: 1,
        accuracy: 0.9,
        coverage: 0.95,
        forwardSkip: seed.forwardSkip ?? false,
        bleedSuspected: seed.bleedSuspected ?? false,
        startedAt: seed.createdAt,
        endedAt: new Date(seed.createdAt.getTime() + 180_000),
        createdAt: seed.createdAt,
      };
    }),
  );
};

export const seedLocaleViews = async (
  db: Database,
  options: { trackId: string; count: number; createdAt: Date },
): Promise<void> => {
  await db.insert(trackViews).values(
    Array.from({ length: options.count }, () => ({
      trackId: options.trackId,
      locale: 'pt-BR' as const,
      createdAt: options.createdAt,
    })),
  );
};
