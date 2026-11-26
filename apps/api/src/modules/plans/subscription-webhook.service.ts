import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { StripeBillingService } from '../../integrations/stripe/stripe-billing.service.js';
import type { verifyStripeEvent } from '../../integrations/stripe/stripe-webhook.js';
import { UsersService } from '../users/users.service.js';
import { refreshSubscription } from './refresh-subscription.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

export type BillingEvent = ReturnType<typeof verifyStripeEvent>;

@Injectable()
export class SubscriptionWebhookService {
  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly stripe: StripeBillingService,
    private readonly users: UsersService,
  ) {}

  async handle(event: BillingEvent): Promise<void> {
    const userId = await this.applyEvent(event);
    if (userId !== undefined) {
      // Wait for commit so the web cannot refill its cache with the old state.
      await this.users.revalidatePublicProfile(userId);
    }
  }

  @Transactional()
  private async applyEvent(event: BillingEvent): Promise<string | undefined> {
    const customer = event.data.object.customer;
    if (!customer) return undefined;
    const userId = await this.repository.userForCustomer(customer);
    if (!userId) return undefined;
    await this.repository.lock(userId);
    if (await this.repository.processed(event.id)) return undefined;
    const changed = await refreshSubscription({
      userId,
      customer,
      event,
      repository: this.repository,
      stripe: this.stripe,
    });
    await this.repository.trackPriceChanges(userId);
    await this.repository.markProcessed(event.id);
    return changed ? userId : undefined;
  }
}
