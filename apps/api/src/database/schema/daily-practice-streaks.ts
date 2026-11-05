import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns.js';
import { users } from './users.js';

/**
 * One practice day of a User: how long they listened and whether they reached
 * their daily target. The streak is the run of completed days.
 *
 * `day` is the calendar day in the User's time zone at the time of the
 * heartbeat (`users.timeZone`), so the day rolls over at their midnight.
 *
 * Legacy mapping: `daily_practice_streaks (userId, day, listenedSeconds,
 * isCompleted, completedAt, lastHeartbeatAt)` maps column for column. Legacy
 * days are UTC days; they are imported as they are, since the legacy app had
 * no time zone to convert them with. `isCompleted` becomes `completed`, the
 * unique (User, day) pair makes replay safe; imported rows retain the legacy
 * UTC date and original timestamps.
 */
export const dailyPracticeStreaks = pgTable(
  'daily_practice_streaks',
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    listenedSeconds: integer().notNull().default(0),
    completed: boolean().notNull().default(false),
    // Legacy practice days start without a reminder.
    reminderQueuedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    lastHeartbeatAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('daily_practice_streaks_user_day_unique').on(
      table.userId,
      table.day,
    ),
    // The streak reads every completed day of one User.
    index().on(table.userId, table.completed),
  ],
);
