import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { CurrentUser, Locale, UserRole } from '@vozzify/contracts';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import { userFollows } from '../../database/schema/user-follows.js';
import { users } from '../../database/schema/users.js';
import { isUniqueViolation } from '../../database/unique-violation.js';

// The follow counts of a Profile, as correlated subqueries of its User row, so
// the banner is read in one query. Friends are the follows answered by a
// follow back (the subquery's `f` is the User's follow, `b` the answer).
// The User's own ID is qualified by table: a bare `id` would resolve to the
// follows table inside the subquery.
const ownUserId = sql`${sql.identifier('users')}.${sql.identifier('id')}`;
const followCountColumns = {
  followersCount: sql<number>`(select count(*)::int from ${userFollows} where ${userFollows.followingId} = ${ownUserId})`,
  followingCount: sql<number>`(select count(*)::int from ${userFollows} where ${userFollows.followerId} = ${ownUserId})`,
  friendsCount: sql<number>`(select count(*)::int from ${userFollows} as f where f.follower_id = ${ownUserId} and exists (select 1 from ${userFollows} as b where b.follower_id = f.following_id and b.following_id = ${ownUserId}))`,
};

export type CurrentUserRow = Omit<
  CurrentUser,
  'createdAt' | 'dailyPracticeTargetSeconds'
> & {
  createdAt: Date;
  // As stored: any integer or null (the column predates the presets).
  // `toCurrentUser` narrows it to a preset for the response.
  dailyPracticeTargetSeconds?: number | null;
};

/** The fields other Users see of an account: no email, no role. */
export type PublicUserRow = {
  id: string;
  username: string | null;
  name: string;
  image: string | null;
};

/** The banner fields of a Profile, read by username. */
export type PublicProfileRow = {
  id: string;
  name: string;
  image: string | null;
  createdAt: Date;
  // As stored, like `CurrentUserRow`: narrowed to a preset by the service.
  dailyPracticeTargetSeconds?: number | null;
  followersCount: number;
  followingCount: number;
  friendsCount: number;
  avatarRole?: UserRole;
};

/** The fields a notification email needs about a User: where it goes and in what language. */
export type EmailRecipientRow = {
  id: string;
  email: string;
  locale: Locale;
};

// Named in migration 0000_init.
const USERNAME_UNIQUE_CONSTRAINT = 'users_username_unique';

const practiceSettingsColumns = {
  dailyPracticeTargetSeconds: users.dailyPracticeTargetSeconds,
  timeZone: users.timeZone,
  lastPracticeHeartbeatAt: users.lastPracticeHeartbeatAt,
};

const currentUserColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  emailVerified: users.emailVerified,
  username: users.username,
  image: users.image,
  role: users.role,
  createdAt: users.createdAt,
  dailyPracticeTargetSeconds: users.dailyPracticeTargetSeconds,
};

/** What the daily practice streak reads about a User. */
export type PracticeSettingsRow = {
  dailyPracticeTargetSeconds: number | null;
  timeZone: string | null;
  lastPracticeHeartbeatAt: Date | null;
};

type SetUsernameResult =
  | { status: 'set'; user: CurrentUserRow }
  // Another user has it.
  | { status: 'taken' }
  // No row matched: the user already has a username, or is gone.
  | { status: 'not-updated' };

@Injectable()
export class UsersRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  /** The ID of the User with this lowercase username, if any. */
  async findIdByUsername(username: string): Promise<string | undefined> {
    const [row] = await this.txHost.tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return row?.id;
  }

  async findCurrentUser(id: string): Promise<CurrentUserRow | undefined> {
    const [row] = await this.txHost.tx
      .select(currentUserColumns)
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row;
  }

  /** Sets the Name and returns the updated user, or nothing when gone. */
  updateName(id: string, name: string): Promise<CurrentUserRow | undefined> {
    return this.updateProfile(id, { name });
  }

  /**
   * Sets the Name and the Avatar's URL in one statement, so the two are
   * never saved apart.
   */
  updateNameAndImage(
    id: string,
    name: string,
    image: string,
  ): Promise<CurrentUserRow | undefined> {
    return this.updateProfile(id, { name, image });
  }

  /**
   * Sets the Name and the Daily target in one statement, so the Profile and
   * the target are never saved apart.
   */
  updateNameAndTarget(
    id: string,
    name: string,
    dailyPracticeTargetSeconds: number,
  ): Promise<CurrentUserRow | undefined> {
    return this.updateProfile(id, { name, dailyPracticeTargetSeconds });
  }

  /**
   * Sets the Name, the Avatar's URL and the Daily target in one statement,
   * so the three are never saved apart.
   */
  updateNameImageAndTarget(
    id: string,
    name: string,
    image: string,
    dailyPracticeTargetSeconds: number,
  ): Promise<CurrentUserRow | undefined> {
    return this.updateProfile(id, { name, image, dailyPracticeTargetSeconds });
  }

  private async updateProfile(
    id: string,
    values: Pick<
      typeof users.$inferInsert,
      'name' | 'image' | 'dailyPracticeTargetSeconds'
    >,
  ): Promise<CurrentUserRow | undefined> {
    const [row] = await this.txHost.tx
      .update(users)
      .set(values)
      .where(eq(users.id, id))
      .returning(currentUserColumns);
    return row;
  }

  /** Sets the language the User's emails follow. */
  async setLocale(id: string, locale: Locale): Promise<void> {
    await this.txHost.tx.update(users).set({ locale }).where(eq(users.id, id));
  }

  /** The practice settings of a User, or nothing when gone. */
  async findPracticeSettings(
    id: string,
  ): Promise<PracticeSettingsRow | undefined> {
    const [row] = await this.txHost.tx
      .select(practiceSettingsColumns)
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row;
  }

  /**
   * The same, locking the User's row until the transaction ends, so a User's
   * heartbeats are checked against their clock one after the other.
   */
  async lockPracticeSettings(
    id: string,
  ): Promise<PracticeSettingsRow | undefined> {
    const [row] = await this.txHost.tx
      .select(practiceSettingsColumns)
      .from(users)
      .where(eq(users.id, id))
      .for('update');
    return row;
  }

  /** Keeps the time zone of a heartbeat and moves the practice clock. */
  async recordPracticeHeartbeat(
    id: string,
    heartbeat: { timeZone: string; clockAt: Date },
  ): Promise<void> {
    await this.txHost.tx
      .update(users)
      .set({
        timeZone: heartbeat.timeZone,
        lastPracticeHeartbeatAt: heartbeat.clockAt,
      })
      .where(eq(users.id, id));
  }

  /** The email and language of the Users given, for the ones that exist. */
  async findEmailRecipients(ids: string[]): Promise<EmailRecipientRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.txHost.tx
      .select({
        id: users.id,
        email: users.email,
        locale: users.locale,
      })
      .from(users)
      .where(inArray(users.id, ids));
  }

  /** The public fields of the Users given, for the ones that exist. */
  async findPublicUsers(ids: string[]): Promise<PublicUserRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.txHost.tx
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        image: users.image,
      })
      .from(users)
      .where(inArray(users.id, ids));
  }

  /**
   * The public banner fields of the User with this (lowercased) username, or
   * undefined when no User has it.
   */
  async findPublicProfileByUsername(
    username: string,
  ): Promise<PublicProfileRow | undefined> {
    const [row] = await this.txHost.tx
      .select({
        id: users.id,
        name: users.name,
        image: users.image,
        createdAt: users.createdAt,
        dailyPracticeTargetSeconds: users.dailyPracticeTargetSeconds,
        ...followCountColumns,
        avatarRole: users.role,
      })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return row;
  }

  /**
   * Sets the username only while it is null, in one statement, so two
   * concurrent requests can't both succeed and a set username never changes.
   */
  async setUsernameIfUnset(
    id: string,
    username: string,
  ): Promise<SetUsernameResult> {
    try {
      const [row] = await this.txHost.tx
        .update(users)
        .set({ username })
        .where(and(eq(users.id, id), isNull(users.username)))
        .returning(currentUserColumns);
      return row ? { status: 'set', user: row } : { status: 'not-updated' };
    } catch (error) {
      if (isUniqueViolation(error, USERNAME_UNIQUE_CONSTRAINT)) {
        return { status: 'taken' };
      }
      throw error;
    }
  }
}
