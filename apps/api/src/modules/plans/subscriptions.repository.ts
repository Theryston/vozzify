import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { CreateSubscriptionChangeBody } from '@vozzify/contracts';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from '../../database/database.js';
import {
  planCatalogSettings,
  planPrices,
  plans,
} from '../../database/schema/plans.js';
import {
  billingCustomers,
  billingEvents,
  subscriptionChanges,
  subscriptionHistory,
  subscriptionPriceChanges,
  subscriptions,
} from '../../database/schema/subscriptions.js';

import { fanOutPriceChanges } from './price-change-fanout.repository.js';
@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly txHost: TransactionHost<DatabaseAdapter>) {}
  async lock(userId: string) {
    await this.txHost.tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`billing-${userId}`}))`,
    );
  }
  async current(userId: string) {
    const rows = await this.txHost.tx
      .select({ contract: subscriptions, copy: plans.copy })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.userId, userId));
    return rows[0];
  }
  async membershipForUsers(userIds: readonly string[]) {
    return this.txHost.tx
      .select({
        userId: subscriptions.userId,
        paidMembership: subscriptions.paidMembership,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        recoveryStartedAt: subscriptions.recoveryStartedAt,
      })
      .from(subscriptions)
      .where(inArray(subscriptions.userId, userIds));
  }
  async price(id: string) {
    const rows = await this.txHost.tx
      .select()
      .from(planPrices)
      .where(eq(planPrices.id, id));
    return rows[0];
  }
  async pendingPrice(userId: string) {
    const rows = await this.txHost.tx
      .select({
        amount: subscriptionPriceChanges.newAmount,
        currency: planPrices.currency,
        effectiveAt: subscriptionPriceChanges.effectiveAt,
        status: subscriptionPriceChanges.scheduleStatus,
      })
      .from(subscriptionPriceChanges)
      .innerJoin(
        planPrices,
        eq(planPrices.id, subscriptionPriceChanges.newPriceId),
      )
      .where(
        and(
          eq(subscriptionPriceChanges.userId, userId),
          eq(subscriptionPriceChanges.noticeStatus, 'sent'),
          inArray(subscriptionPriceChanges.scheduleStatus, [
            'pending',
            'scheduled',
            'failed',
          ]),
        ),
      )
      .orderBy(asc(subscriptionPriceChanges.sequence))
      .limit(1);
    return rows[0];
  }
  async cancelReprices(userId: string, acceptedChangeId: string) {
    const repricing = await this.txHost.tx
      .select({ id: subscriptionPriceChanges.id })
      .from(subscriptionPriceChanges)
      .where(eq(subscriptionPriceChanges.id, acceptedChangeId));
    if (repricing.length) return;
    await this.txHost.tx
      .update(subscriptionPriceChanges)
      .set({ scheduleStatus: 'cancelled' })
      .where(
        and(
          eq(subscriptionPriceChanges.userId, userId),
          ne(subscriptionPriceChanges.id, acceptedChangeId),
          inArray(subscriptionPriceChanges.scheduleStatus, [
            'pending',
            'scheduled',
            'failed',
          ]),
        ),
      );
  }
  async customer(userId: string) {
    const rows = await this.txHost.tx
      .select()
      .from(billingCustomers)
      .where(eq(billingCustomers.userId, userId));
    return rows[0];
  }
  async markTrialUsed(userId: string) {
    await this.txHost.tx
      .update(billingCustomers)
      .set({ trialUsedAt: new Date() })
      .where(
        and(
          eq(billingCustomers.userId, userId),
          sql`${billingCustomers.trialUsedAt} is null`,
        ),
      );
  }
  async userForCustomer(customer: string) {
    const rows = await this.txHost.tx
      .select({ userId: billingCustomers.userId })
      .from(billingCustomers)
      .where(eq(billingCustomers.stripeCustomerId, customer));
    return rows[0]?.userId;
  }
  async saveCustomer(userId: string, customer: string) {
    await this.txHost.tx
      .insert(billingCustomers)
      .values({ userId, stripeCustomerId: customer })
      .onConflictDoUpdate({
        target: billingCustomers.userId,
        set: { stripeCustomerId: customer },
      });
  }
  async offer(body: Pick<CreateSubscriptionChangeBody, 'planId'>) {
    const rows = await this.txHost.tx
      .select({ plan: plans, price: planPrices })
      .from(plans)
      .innerJoin(
        planPrices,
        and(eq(plans.id, planPrices.planId), eq(planPrices.current, true)),
      )
      .where(eq(plans.id, body.planId));
    const settings = await this.txHost.tx
      .select()
      .from(planCatalogSettings)
      .where(eq(planCatalogSettings.id, 'catalog'));
    return { rows, enabled: settings[0]?.contractingEnabled === true };
  }
  async archive(contract: typeof subscriptions.$inferSelect) {
    await this.txHost.tx
      .update(subscriptionPriceChanges)
      .set({ scheduleStatus: 'cancelled' })
      .where(
        and(
          eq(subscriptionPriceChanges.subscriptionId, contract.id),
          inArray(subscriptionPriceChanges.scheduleStatus, [
            'pending',
            'failed',
            'scheduled',
          ]),
        ),
      );
    await this.txHost.tx
      .insert(subscriptionHistory)
      .values({ id: contract.id, userId: contract.userId, contract })
      .onConflictDoNothing();
  }
  async remove(userId: string) {
    await this.txHost.tx
      .delete(subscriptions)
      .where(eq(subscriptions.userId, userId));
  }
  async create(input: typeof subscriptions.$inferInsert) {
    await this.txHost.tx.insert(subscriptions).values(input);
  }
  async update(
    userId: string,
    input: Partial<typeof subscriptions.$inferInsert>,
  ) {
    await this.txHost.tx
      .update(subscriptions)
      .set(input)
      .where(eq(subscriptions.userId, userId));
  }
  async processed(id: string) {
    return (
      (
        await this.txHost.tx
          .select({ id: billingEvents.id })
          .from(billingEvents)
          .where(eq(billingEvents.providerEventId, id))
      ).length > 0
    );
  }
  async markProcessed(id: string) {
    await this.txHost.tx
      .insert(billingEvents)
      .values({ providerEventId: id })
      .onConflictDoNothing();
  }
  async trackPriceChanges(userId: string) {
    const contract = await this.current(userId);
    if (!contract) return;
    // Serialize late checkout confirmation with publication of a new price.
    await this.txHost.tx
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.id, contract.contract.planId))
      .for('update');
    await fanOutPriceChanges(this.txHost.tx, { userId });
  }
  async change(userId: string) {
    const rows = await this.txHost.tx
      .select({ change: subscriptionChanges, copy: plans.copy })
      .from(subscriptionChanges)
      .innerJoin(plans, eq(plans.id, subscriptionChanges.planId))
      .where(eq(subscriptionChanges.userId, userId));
    return rows[0];
  }
  async saveChange(input: typeof subscriptionChanges.$inferInsert) {
    await this.txHost.tx
      .insert(subscriptionChanges)
      .values(input)
      .onConflictDoUpdate({
        target: subscriptionChanges.userId,
        set: input,
      });
  }
  async updateChange(
    userId: string,
    input: Partial<typeof subscriptionChanges.$inferInsert>,
  ) {
    await this.txHost.tx
      .update(subscriptionChanges)
      .set(input)
      .where(eq(subscriptionChanges.userId, userId));
  }
  async deleteChange(userId: string) {
    await this.txHost.tx
      .delete(subscriptionChanges)
      .where(eq(subscriptionChanges.userId, userId));
  }
  async planCopy(planId: string) {
    const rows = await this.txHost.tx
      .select({ copy: plans.copy })
      .from(plans)
      .where(eq(plans.id, planId));
    return rows[0]?.copy;
  }
}
