import { z } from 'zod';

// The daily practice streak: `POST /v1/me/streak/heartbeat` credits singing
// time and `GET /v1/me/streak` reads where today stands. The practice day is
// the User's own calendar day, so every request names or implies a time zone.

/** Whether the runtime knows `timeZone` as an IANA zone (`America/Sao_Paulo`). */
const isTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** An IANA time zone name, as the browser reports it. */
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, { message: 'Unknown IANA time zone' });

/**
 * The most seconds one heartbeat credits. The web sends one every 5 s while
 * the User sings, so 20 leaves room for a late or throttled tab.
 */
export const STREAK_MAX_HEARTBEAT_SECONDS = 20;

/** The body of `POST /v1/me/streak/heartbeat`. */
export const streakHeartbeatBodySchema = z.object({
  // What the browser measured since its last heartbeat. The API trusts it only
  // up to the cap and the time its own clock saw pass.
  elapsedSeconds: z.number().min(0),
  timeZone: timeZoneSchema,
  /** The Track page view that produced this practice time. */
  viewId: z.string().min(1).max(128).optional(),
  /** The private Track to authorize. Private heartbeats have no public view. */
  privateTrackId: z.string().min(1).max(128).optional(),
});

export type StreakHeartbeatBody = z.infer<typeof streakHeartbeatBodySchema>;

/** The query of `GET /v1/me/streak`. */
export const streakStatusQuerySchema = z.object({
  // The zone to read "today" in; the one the last heartbeat stored when
  // missing, UTC for a User who never practiced.
  timeZone: timeZoneSchema.optional(),
});

export type StreakStatusQuery = z.infer<typeof streakStatusQuerySchema>;

/** Where today stands against the User's daily target. */
export const streakStatusSchema = z.object({
  // The practice day: `YYYY-MM-DD` in the User's time zone.
  day: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  // Capped at the target, so a full ring never reads past 100%.
  listenedSeconds: z.number().int().min(0),
  targetSeconds: z.number().int().positive(),
  completedToday: z.boolean(),
  // Consecutive completed days up to today, or up to yesterday while today is
  // still open, so the streak is not lost before the day ends.
  currentStreakDays: z.number().int().min(0),
});

export type StreakStatus = z.infer<typeof streakStatusSchema>;

export const streakHeartbeatResultSchema = z.object({
  status: streakStatusSchema,
  // True on the one heartbeat that reached the target.
  justCompleted: z.boolean(),
  // What the API counted, which may be less than what was sent.
  creditedSeconds: z.number().int().min(0),
});

export type StreakHeartbeatResult = z.infer<typeof streakHeartbeatResultSchema>;
