import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  asDailyPracticeTargetSeconds,
  type StreakHeartbeatBody,
  type StreakHeartbeatResult,
  type StreakStatus,
} from '@vozzify/contracts';
import { UsersService } from '../users/users.service.js';
import {
  creditHeartbeat,
  currentStreakDays,
  DEFAULT_TARGET_SECONDS,
  localDayOf,
} from './streak-rules.js';
import {
  type PracticeDayRow,
  StreaksRepository,
} from './streaks.repository.js';

const FALLBACK_TIME_ZONE = 'UTC';

// The same read boundary as the profile: only the presets count, so a
// legacy non-preset value and the profile never disagree on the target.
const validTarget = (seconds: number | null): number =>
  asDailyPracticeTargetSeconds(seconds) ?? DEFAULT_TARGET_SECONDS;

/**
 * The daily practice streak. A heartbeat credits singing time to the User's
 * current day, which is the calendar day in their time zone, so it rolls over
 * at their midnight. A day is completed when it reaches the User's daily
 * target, and the streak is the run of completed days.
 */
@Injectable()
export class StreaksService {
  constructor(
    private readonly streaks: StreaksRepository,
    private readonly users: UsersService,
  ) {}

  /** Uses the User's practice-day boundary for ranking activity evidence. */
  practiceDayOf(date: Date, timeZone: string): string {
    return localDayOf(date, timeZone);
  }

  /** Where today stands, in `timeZone` or the one the last heartbeat kept. */
  async getStatus(
    userId: string,
    timeZone: string | undefined,
  ): Promise<StreakStatus> {
    const settings = await this.users.getPracticeSettings(userId);
    const zone = timeZone ?? settings.timeZone ?? FALLBACK_TIME_ZONE;
    const day = localDayOf(new Date(), zone);
    return this.statusOf(
      userId,
      await this.streaks.findDay(userId, day),
      day,
      validTarget(settings.dailyPracticeTargetSeconds),
    );
  }

  /**
   * Credits the heartbeat (see `creditHeartbeat`), keeps the time zone it names
   * and completes the day when the target is reached. The User's row is locked
   * first: their heartbeats run one after the other, against one practice clock
   * for every day and zone, so only one of them can complete a day and
   * switching zones starts no second clock. A heartbeat with no whole second
   * writes nothing.
   */
  @Transactional()
  async heartbeat(
    userId: string,
    body: StreakHeartbeatBody,
  ): Promise<StreakHeartbeatResult> {
    const now = new Date();
    const settings = await this.users.lockPracticeSettings(userId);
    const day = localDayOf(now, body.timeZone);
    const target = validTarget(settings.dailyPracticeTargetSeconds);
    const credit = creditHeartbeat({
      elapsedSeconds: body.elapsedSeconds,
      lastHeartbeatAt: settings.lastPracticeHeartbeatAt,
      now,
    });
    if (body.viewId !== undefined && body.elapsedSeconds >= 1) {
      const elapsedSeconds = Math.floor(body.elapsedSeconds);
      await this.streaks.recordAttributedHeartbeat({
        userId,
        viewId: body.viewId,
        elapsedSeconds,
        creditedSeconds: credit.creditedSeconds,
      });
    }
    if (body.elapsedSeconds < 1) {
      return {
        status: await this.statusOf(
          userId,
          await this.streaks.findDay(userId, day),
          day,
          target,
        ),
        justCompleted: false,
        creditedSeconds: 0,
      };
    }

    await this.users.recordPracticeHeartbeat(userId, {
      timeZone: body.timeZone,
      clockAt: credit.clockAt,
    });
    const row = await this.streaks.lockDay(userId, day);
    const listenedSeconds = row.listenedSeconds + credit.creditedSeconds;
    const justCompleted = !row.completed && listenedSeconds >= target;
    await this.streaks.saveHeartbeat(row.id, {
      listenedSeconds,
      heartbeatAt: credit.clockAt,
      completesDay: justCompleted,
    });
    const saved: PracticeDayRow = {
      ...row,
      listenedSeconds,
      completed: row.completed || justCompleted,
    };
    return {
      status: await this.statusOf(userId, saved, day, target),
      justCompleted,
      creditedSeconds: credit.creditedSeconds,
    };
  }

  private async statusOf(
    userId: string,
    row: PracticeDayRow | undefined,
    day: string,
    targetSeconds: number,
  ): Promise<StreakStatus> {
    const completedToday = row?.completed ?? false;
    const completedDays = new Set(await this.streaks.findCompletedDays(userId));
    return {
      day,
      listenedSeconds: completedToday
        ? targetSeconds
        : Math.min(row?.listenedSeconds ?? 0, targetSeconds),
      targetSeconds,
      completedToday,
      currentStreakDays: currentStreakDays(completedDays, day),
    };
  }
}
