import { Inject, Injectable } from '@nestjs/common';
import type { Locale } from '@vozzify/contracts';
import { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';
import { ENV, type Env } from '../../config/env.js';
import en from './locales/en.json' with { type: 'json' };
import ptBR from './locales/pt-BR.json' with { type: 'json' };
import {
  type StripeCheckout,
  type StripeSubscription,
  sessionSchema,
  subscriptionSchema,
} from './stripe-billing-schemas.js';

export type {
  StripeCheckout,
  StripeSubscription,
} from './stripe-billing-schemas.js';

import { firstInvoiceFailure } from './stripe-failure-history.js';
import { parseStripeResponse } from './stripe-mode.js';
import { portalConfiguration } from './stripe-portal-schema.js';
import {
  type ScheduleInput,
  scheduleForProvider,
  validateSchedule,
} from './stripe-schedule.js';
import { trialPayment } from './stripe-trial-payment.js';
import { updateSchedule } from './stripe-update-schedule.js';

@Injectable()
export class StripeBillingService {
  constructor(@Inject(ENV) private readonly env: Env) {}
  async createCustomer(userId: string) {
    return z.object({ id: z.string(), livemode: z.boolean() }).parse(
      await this.request(
        'customers',
        {
          'metadata[userId]': userId,
        },
        `customer-${userId}`,
      ),
    ).id;
  }
  async createCheckout(input: {
    id: string;
    customer: string;
    price: string;
    locale: Locale;
    trialDays?: number;
  }) {
    const base = `${this.env.WEB_URL}/${input.locale}/subscription`;
    return sessionSchema.parse(
      await this.request(
        'checkout/sessions',
        {
          mode: 'subscription',
          customer: input.customer,
          'line_items[0][price]': input.price,
          'line_items[0][quantity]': '1',
          ...(input.trialDays
            ? {
                'subscription_data[trial_period_days]': String(input.trialDays),
                payment_method_collection: 'always',
                'payment_method_types[0]': 'card',
              }
            : {}),
          success_url: `${base}?result=pending`,
          cancel_url: `${base}?result=cancelled`,
          locale: input.locale === 'pt-BR' ? 'pt-BR' : 'en',
          'metadata[contractId]': input.id,
          'custom_text[submit][message]': input.trialDays
            ? (input.locale === 'pt-BR' ? ptBR : en).trialCheckoutDisclosure
            : (input.locale === 'pt-BR' ? ptBR : en).checkoutDisclosure,
        },
        `checkout-${input.id}`,
      ),
    );
  }
  async createPortal(customer: string, locale: Locale) {
    const configuration = this.env.STRIPE_PORTAL_CONFIGURATION_ID;
    if (!configuration)
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'Stripe portal configuration is missing',
      );
    const config = portalConfiguration.safeParse(
      await this.request(
        `billing_portal/configurations/${encodeURIComponent(configuration)}`,
      ),
    );
    if (!config.success)
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'Stripe portal configuration is unsafe',
      );
    const session = z.object({ url: z.url(), livemode: z.boolean() }).parse(
      await this.request('billing_portal/sessions', {
        customer,
        configuration,
        return_url: `${this.env.WEB_URL}/${locale}/subscription`,
        locale: locale === 'pt-BR' ? 'pt-BR' : 'en',
      }),
    );
    return session.url;
  }
  async findCheckout(
    customer: string,
    contractId: string,
  ): Promise<StripeCheckout | null> {
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({
        customer,
        limit: '100',
        ...(cursor ? { starting_after: cursor } : {}),
      });
      const page = z
        .object({
          data: z.array(
            sessionSchema.extend({
              metadata: z.record(z.string(), z.string()),
            }),
          ),
          has_more: z.boolean(),
        })
        .parse(await this.request(`checkout/sessions?${query}`));
      const match = page.data.find(
        (session) => session.metadata.contractId === contractId,
      );
      if (match) return match;
      cursor = page.has_more ? page.data.at(-1)?.id : undefined;
      if (page.has_more && !cursor)
        throw new AppException(
          'SERVICE_UNAVAILABLE',
          'Stripe checkout reconciliation is incomplete',
        );
    } while (cursor);
    return null;
  }
  async getCheckout(id: string): Promise<StripeCheckout> {
    return sessionSchema.parse(
      await this.request(`checkout/sessions/${encodeURIComponent(id)}`),
    );
  }
  async expireCheckout(id: string): Promise<StripeCheckout> {
    return sessionSchema.parse(
      await this.request(
        `checkout/sessions/${encodeURIComponent(id)}/expire`,
        {},
      ),
    );
  }
  async getSubscription(id: string): Promise<StripeSubscription> {
    const subscription = subscriptionSchema.parse(
      await this.request(
        `subscriptions/${encodeURIComponent(id)}?expand[]=latest_invoice`,
      ),
    );
    return trialPayment(subscription, (path) => this.request(path));
  }

  async firstInvoiceFailure(input: {
    invoiceId: string;
    customer: string;
    invoiceCreated: number;
    latestFailure: number;
  }): Promise<number> {
    return firstInvoiceFailure(input, (path) => this.request(path));
  }
  async prepareSchedule(input: ScheduleInput) {
    const provider = await this.schedulableSubscription(input);
    if (input.nextPrice === input.currentPrice)
      return provider.schedule ?? null;
    if (
      input.schedule &&
      provider.schedule &&
      input.schedule !== provider.schedule
    )
      throw new AppException('CONFLICT', 'Subscription schedule changed');
    const schedule =
      input.schedule ??
      provider.schedule ??
      z
        .object({ id: z.string(), livemode: z.boolean() })
        .parse(
          await this.request(
            'subscription_schedules',
            { from_subscription: input.subscription },
            `schedule-${input.id}`,
          ),
        ).id;
    validateSchedule(
      await this.request(
        `subscription_schedules/${encodeURIComponent(schedule)}`,
      ),
      scheduleForProvider(input, provider),
      schedule,
    );
    return schedule;
  }

  async inspectSchedule(input: ScheduleInput) {
    const provider = await this.schedulableSubscription(input);
    if (input.nextPrice === input.currentPrice && !provider.schedule)
      return 'pending' as const;
    const schedule = input.schedule ?? provider.schedule;
    if (!schedule) {
      if (input.previousPrice)
        throw new AppException(
          'CONFLICT',
          'Previous subscription schedule is missing',
        );
      return 'previous' as const;
    }
    const price = validateSchedule(
      await this.request(
        `subscription_schedules/${encodeURIComponent(schedule)}`,
      ),
      scheduleForProvider(input, provider),
      schedule,
    );
    if (price === input.nextPrice) return 'pending' as const;
    if (
      provider.status === 'trialing' &&
      !input.previousPrice &&
      price === input.currentPrice
    )
      return 'previous' as const;
    if (price === input.previousPrice || (!price && !input.previousPrice))
      return 'previous' as const;
    throw new AppException(
      'CONFLICT',
      'Subscription schedule is not reconciled',
    );
  }

  async scheduleChange(input: ScheduleInput) {
    const provider = await this.schedulableSubscription(input);
    return updateSchedule(input, provider, (path, body, key) =>
      this.request(path, body, key),
    );
  }

  private async schedulableSubscription(input: ScheduleInput) {
    const provider = await this.getSubscription(input.subscription);
    const item = provider.items.data[0];
    if (
      provider.cancel_at_period_end ||
      (provider.status !== 'active' &&
        (provider.status !== 'trialing' || provider.trial_end !== input.end)) ||
      !item ||
      item.price.id !== input.currentPrice ||
      item.current_period_start !== input.start ||
      item.current_period_end !== input.end ||
      input.end * 1000 <= Date.now() ||
      (input.schedule &&
        provider.schedule &&
        provider.schedule !== input.schedule)
    )
      throw new AppException(
        'CONFLICT',
        'Subscription changed before scheduling',
      );
    return provider;
  }
  private async request(
    path: string,
    body?: Record<string, string>,
    key?: string,
  ): Promise<unknown> {
    if (!this.env.STRIPE_SECRET_KEY)
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'Stripe configuration is missing',
      );
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${this.env.STRIPE_SECRET_KEY}`,
        'Stripe-Version': '2025-06-30.basil',
        ...(body
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'Stripe billing request failed',
      );
    return parseStripeResponse(
      await response.json(),
      this.env.STRIPE_SECRET_KEY,
    );
  }
}
