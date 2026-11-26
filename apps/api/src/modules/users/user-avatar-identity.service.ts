import { Injectable } from '@nestjs/common';
import type { AvatarIdentity, UserRole } from '@vozzify/contracts';
import { SubscriptionMembershipService } from '../plans/subscription-membership.service.js';
import { UsersRepository } from './users.repository.js';

/** The two public marks drawn from independent roles and subscriptions. */
export function avatarIdentityFields(
  pro: boolean | undefined,
  role?: UserRole,
): {
  avatarIdentity?: AvatarIdentity;
} {
  const admin = role === 'ADMIN';
  return admin || pro
    ? { avatarIdentity: { ...(pro && { pro }), ...(admin && { admin }) } }
    : {};
}

@Injectable()
export class UserAvatarIdentityService {
  constructor(
    private readonly users: UsersRepository,
    private readonly membership: SubscriptionMembershipService,
  ) {}

  /** The presentation marks of the displayed Users, without their private roles. */
  async findByUserIds(
    userIds: readonly string[],
  ): Promise<Map<string, AvatarIdentity>> {
    const [roles, paid] = await Promise.all([
      this.users.findAvatarRoles(userIds),
      this.membership.paidMemberIds(userIds),
    ]);
    const identities = new Map<string, AvatarIdentity>();
    for (const { id, role } of roles) {
      const { avatarIdentity } = avatarIdentityFields(paid.has(id), role);
      if (avatarIdentity !== undefined) identities.set(id, avatarIdentity);
    }
    return identities;
  }
}
