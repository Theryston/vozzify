import { Module } from '@nestjs/common';
import { SubscriptionMembershipService } from './subscription-membership.service.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

/** Read access to effective membership without bringing in billing workflows. */
@Module({
  providers: [SubscriptionsRepository, SubscriptionMembershipService],
  exports: [SubscriptionsRepository, SubscriptionMembershipService],
})
export class SubscriptionMembershipModule {}
