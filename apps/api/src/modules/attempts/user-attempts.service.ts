import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type {
  ListUserAttemptsQuery,
  PracticeAttemptHistoryPage,
  TrackHeader,
} from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import type { DatabaseAdapter } from '../../database/database.js';
import { PrivateTrackPracticeAccessService } from '../private-tracks/private-track-practice-access.service.js';
import { UsersService } from '../users/users.service.js';
import type { AttemptHistoryQuery } from './attempt-history.repository.js';
import {
  type PracticeAttemptReadRow,
  toPracticeAttempt,
} from './attempt-view.js';
import {
  AttemptsRepository,
  type PracticeAttemptHistoryRow,
} from './attempts.repository.js';
import {
  decodeOwnAttemptCursor,
  mergeAttemptPages,
  nextOwnAttemptCursor,
} from './own-attempt-cursor.js';

/**
 * The practice history of a User, addressed by username. The Profile owner
 * can include the runs they saved for their private Tracks.
 */
@Injectable()
export class UserAttemptsService {
  constructor(
    private readonly attempts: AttemptsRepository,
    private readonly users: UsersService,
    private readonly privateTracks: PrivateTrackPracticeAccessService,
  ) {}

  /**
   * One page of the User's runs, newest first. Each request reads fresh history
   * so the next visit can show a newly saved run. Usernames are case-insensitive.
   */
  async listHistory(
    username: string,
    query: ListUserAttemptsQuery,
    viewerId?: string,
  ): Promise<PracticeAttemptHistoryPage> {
    const userId = await this.users.findUserIdByUsername(username);
    if (userId === undefined) {
      throw new AppException('NOT_FOUND', 'User not found');
    }
    const options = {
      userId,
      after: query.cursor ? decodeOwnAttemptCursor(query.cursor) : undefined,
      // One more than asked tells whether another page follows.
      limit: query.limit + 1,
    };
    const rows =
      query.includePrivate === 'true' && viewerId === userId
        ? await this.listOwnerHistory(options)
        : await this.attempts.listHistory(options);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(({ attempt, track }) => ({
        ...toPracticeAttempt(attempt),
        track,
      })),
      nextCursor: nextOwnAttemptCursor(
        page.at(-1)?.attempt,
        rows.length > query.limit,
      ),
    };
  }

  /** A deletion must not leave attempts and headers from different snapshots. */
  @Transactional<DatabaseAdapter>({
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  })
  private async listOwnerHistory(
    options: AttemptHistoryQuery,
  ): Promise<PracticeAttemptHistoryRow[]> {
    const [publicRows, privateAttempts] = await Promise.all([
      this.attempts.listHistory(options),
      this.attempts.listOwnedPrivateAttempts(options),
    ]);
    const rows = mergeAttemptPages<{
      attempt: PracticeAttemptReadRow;
      track?: TrackHeader;
    }>(
      publicRows,
      privateAttempts.map((attempt) => ({ attempt })),
      (row) => row.attempt,
      options.limit,
    );
    const headers = await this.privateTracks.listOwnedHistoryHeaders(
      options.userId,
      rows.flatMap((row) => (row.track ? [] : [row.attempt.trackId])),
    );
    return rows.flatMap(({ attempt, track }) => {
      const header = track ?? headers.get(attempt.trackId);
      return header ? [{ attempt, track: header }] : [];
    });
  }
}
