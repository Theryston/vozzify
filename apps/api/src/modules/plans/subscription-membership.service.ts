import { Injectable } from '@nestjs/common';
import type { AvatarIdentity, UserRole } from '@vozzify/contracts';
import { isPaidMembershipActive } from './renewal-recovery.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

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
export class SubscriptionMembershipService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async hasPaidMembership(userId: string): Promise<boolean> {
    const row = await this.repository.current(userId);
    if (!row) return false;
    return isPaidMembershipActive(row.contract);
  }

  /** Reads effective paid membership in one query for the given Users. */
  async paidMemberIds(
    userIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (userIds.length === 0) return new Set();
    const contracts = await this.repository.membershipForUsers(userIds);
    return new Set(
      contracts.filter(isPaidMembershipActive).map(({ userId }) => userId),
    );
  }
}
