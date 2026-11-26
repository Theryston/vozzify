import { Injectable } from '@nestjs/common';
import type { AvatarIdentity, UserRole } from '@vozzify/contracts';
import { isPaidMembershipActive } from './renewal-recovery.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

export type AvatarIdentityInputs = {
  avatarRole?: UserRole;
  avatarMembership?: Parameters<typeof isPaidMembershipActive>[0] | null;
};

/** Projects only the displayed User's public marks from the selected inputs. */
export function avatarIdentityFields(input: AvatarIdentityInputs): {
  avatarIdentity?: AvatarIdentity;
} {
  const admin = input.avatarRole === 'ADMIN';
  const pro =
    input.avatarMembership != null &&
    isPaidMembershipActive(input.avatarMembership);
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
}
