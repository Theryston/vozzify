import { Injectable, Optional } from '@nestjs/common';
import {
  asDailyPracticeTargetSeconds,
  type PublicProfile,
} from '@vozzify/contracts';
import { AppException } from '../../common/errors/app-exception.js';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { avatarIdentityFields } from './user-avatar-identity.service.js';
import { UsersRepository } from './users.repository.js';

/**
 * The banner fields a User's own row provides. The Daily target is absent
 * when unset (the banner has no chips of its own: the chips are added by the
 * profiles module, which owns the response shape).
 */
export type PublicProfileBanner = Pick<
  PublicProfile,
  | 'username'
  | 'name'
  | 'image'
  | 'avatarIdentity'
  | 'createdAt'
  | 'followersCount'
  | 'followingCount'
  | 'friendsCount'
> &
  Partial<Pick<PublicProfile, 'dailyPracticeTargetSeconds'>>;

/** A Profile's banner, with the internal ID its chips are computed from. */
export type PublicProfileLookup = {
  userId: string;
  profile: PublicProfileBanner;
};

/**
 * The public Profile of a User, addressed by username. Only the banner
 * fields are read here: nothing a visitor may not see leaves the module.
 */
@Injectable()
export class UserProfileService {
  constructor(
    private readonly usersRepository: UsersRepository,
    @Optional() private readonly membership?: SubscriptionMembershipService,
  ) {}

  /**
   * Usernames are stored lowercase, so the lookup lowercases the request
   * (any casing finds the same Profile). An unknown username is `NOT_FOUND`.
   */
  async getPublicProfile(username: string): Promise<PublicProfileBanner> {
    return (await this.findPublicProfile(username)).profile;
  }

  /** The banner of a Profile and the ID of its User. */
  async findPublicProfile(username: string): Promise<PublicProfileLookup> {
    const normalized = username.toLowerCase();
    const row =
      await this.usersRepository.findPublicProfileByUsername(normalized);
    if (!row) {
      throw new AppException('NOT_FOUND', 'User not found');
    }
    const pro = await this.membership?.hasPaidMembership(row.id);
    // The Daily target is shown only when the User picked a preset.
    const dailyTarget = asDailyPracticeTargetSeconds(
      row.dailyPracticeTargetSeconds,
    );
    return {
      userId: row.id,
      profile: {
        username: normalized,
        name: row.name,
        image: row.image,
        ...avatarIdentityFields(pro, row.avatarRole),
        createdAt: row.createdAt.toISOString(),
        followersCount: row.followersCount,
        followingCount: row.followingCount,
        friendsCount: row.friendsCount,
        ...(dailyTarget === null
          ? {}
          : { dailyPracticeTargetSeconds: dailyTarget }),
      },
    };
  }
}
