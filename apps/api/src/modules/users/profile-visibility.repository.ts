import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { eq, inArray } from 'drizzle-orm';
import { avatarIdentityColumns } from '../../database/avatar-identity-columns.js';
import type { DatabaseAdapter } from '../../database/database.js';
import { subscriptions } from '../../database/schema/subscriptions.js';
import { users } from '../../database/schema/users.js';
import type { AvatarIdentityInputs } from '../plans/subscription-membership.service.js';

/** The section visibility flags of a User, with the username that addresses it. */
export type ProfileVisibilityRow = {
  id: string;
  username: string | null;
  showSummarySection: boolean;
  showPracticeHistorySection: boolean;
  showFavoritesSection: boolean;
};

/** The section flags to set in one statement: only those given change. */
type SocialProfileRow = ProfileVisibilityRow &
  AvatarIdentityInputs & { name?: string; image?: string | null };

export type ProfileVisibilityValues = Partial<
  Pick<
    ProfileVisibilityRow,
    'showSummarySection' | 'showPracticeHistorySection' | 'showFavoritesSection'
  >
>;

const profileVisibilityColumns = {
  id: users.id,
  username: users.username,
  showSummarySection: users.showSummarySection,
  showPracticeHistorySection: users.showPracticeHistorySection,
  showFavoritesSection: users.showFavoritesSection,
};

/** The section flags of the users row (the visibility of a Profile's sections). */
@Injectable()
export class ProfileVisibilityRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}

  /** The section flags of the User with this ID, or nothing when gone. */
  async findById(id: string): Promise<ProfileVisibilityRow | undefined> {
    const [row] = await this.txHost.tx
      .select(profileVisibilityColumns)
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row;
  }

  /** The section flags of the User with this (lowercased) username, if any. */
  async findByUsername(
    username: string,
  ): Promise<ProfileVisibilityRow | undefined> {
    const [row] = await this.txHost.tx
      .select(profileVisibilityColumns)
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return row;
  }

  /** The current section flags for a bounded set of public Profile owners. */
  async findManyByIds(ids: string[]): Promise<SocialProfileRow[]> {
    if (ids.length === 0) return [];
    return this.txHost.tx
      .select({
        ...profileVisibilityColumns,
        ...avatarIdentityColumns,
        name: users.name,
        image: users.image,
      })
      .from(users)
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(inArray(users.id, ids));
  }

  /** Sets the section flags given and returns the User's flags, or nothing when gone. */
  async update(
    id: string,
    values: ProfileVisibilityValues,
  ): Promise<ProfileVisibilityRow | undefined> {
    const [row] = await this.txHost.tx
      .update(users)
      .set(values)
      .where(eq(users.id, id))
      .returning(profileVisibilityColumns);
    return row;
  }
}
