import { Injectable } from '@nestjs/common';
import { isPaidMembershipActive } from './renewal-recovery.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

@Injectable()
export class SubscriptionMembershipService {
  constructor(private readonly repository: SubscriptionsRepository) {}

  async hasPaidMembership(userId: string): Promise<boolean> {
    const row = await this.repository.current(userId);
    if (!row) return false;
    return isPaidMembershipActive(row.contract);
  }
}
