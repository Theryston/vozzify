import { parseEnv } from '../../config/env.js';
import { StripeBillingService } from './stripe-billing.service.js';
import type { StripeSubscription } from './stripe-billing-schemas.js';
import { StripeCatalogService } from './stripe-catalog.service.js';
import type { ScheduleInput } from './stripe-schedule.js';

const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://localhost/stripe-live',
  REDIS_URL: 'redis://localhost',
  STRIPE_SECRET_KEY: 'sk_live_unit',
  STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_live',
  WEB_URL: 'https://vozzify.example',
});
const session = {
  customer: 'cus_live',
  subscription: null,
  livemode: true,
  id: 'cs_live',
  status: 'open',
  url: 'https://checkout.stripe.com/live',
};
const start = Date.UTC(2026, 0, 15) / 1000;
const end = Date.UTC(2026, 1, 15) / 1000;
const period = { current_period_start: start, current_period_end: end };
const subscription: StripeSubscription = {
  customer: 'cus_live',
  livemode: true,
  id: 'sub_live',
  currency: 'usd',
  status: 'active',
  latest_invoice: { amount_paid: 350, status: 'paid' },
  cancel_at_period_end: false,
  items: {
    data: [
      {
        ...period,
        price: { currency: 'usd', id: 'price_current', unit_amount: 350 },
      },
    ],
  },
};
const input: ScheduleInput = {
  ...{ start, end },
  id: 'live-change',
  subscription: 'sub_live',
  currentPrice: 'price_current',
  nextPrice: 'price_next',
  nextCycle: 'monthly',
  schedule: null,
  previousPrice: null,
  previousCycle: null,
};
const schedule = {
  subscription: 'sub_live',
  id: 'sched_live',
  status: 'active',
  livemode: true,
  phases: [
    {
      items: [{ quantity: 1, price: input.currentPrice }],
      end_date: end,
      start_date: start,
    },
    {
      items: [{ quantity: 1, price: input.nextPrice }],
      end_date: Date.UTC(2026, 2, 15) / 1000,
      start_date: end,
    },
  ],
};
const portal = {
  livemode: true,
  active: true,
  features: {
    payment_method_update: { enabled: true },
    subscription_update: { enabled: false },
    invoice_history: { enabled: true },
    subscription_cancel: { mode: 'at_period_end', enabled: true },
  },
};

describe('Stripe live account operations', () => {
  const network = vi.fn<typeof fetch>();
  const billing = new StripeBillingService(env);
  beforeEach(() => {
    network.mockReset();
    vi.stubGlobal('fetch', network);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-16T12:00:00Z'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('synchronizes live products and creates live prices', async () => {
    network
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(Response.json({ livemode: true, id: 'prod_live' }))
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(
        Response.json({ livemode: true, id: 'price_live' }),
      );
    const catalog = new StripeCatalogService(env);
    const productId = await catalog.syncProduct({
      operationId: 'publish-live',
      planId: 'live',
      copy: {
        en: { description: 'Singing practice.', name: 'Live plan' },
        'pt-BR': { description: 'Singing practice.', name: 'Live plan' },
      },
    });
    expect(productId).toBe('prod_live');
    expect(
      await catalog.ensurePrice({
        productId,
        key: 'live-monthly-usd',
        currency: 'USD',
        cycle: 'monthly',
        amount: 350,
      }),
    ).toBe('price_live');
    expect(network.mock.calls[3]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer sk_live_unit',
    });
  });

  it('creates, reads, expires and reconciles live checkout sessions', async () => {
    network
      .mockResolvedValueOnce(Response.json({ livemode: true, id: 'cus_live' }))
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json({ ...session, status: 'expired' }))
      .mockResolvedValueOnce(
        Response.json({
          has_more: false,
          data: [{ ...session, metadata: { contractId: 'attempt_live' } }],
        }),
      );
    expect(await billing.createCustomer('user_live')).toBe('cus_live');
    expect(
      await billing.createCheckout({
        locale: 'en',
        price: 'price_live',
        customer: 'cus_live',
        id: 'attempt_live',
      }),
    ).toMatchObject({ livemode: true, id: 'cs_live' });
    expect((await billing.getCheckout('cs_live')).livemode).toBe(true);
    expect((await billing.expireCheckout('cs_live')).status).toBe('expired');
    expect((await billing.findCheckout('cus_live', 'attempt_live'))?.id).toBe(
      'cs_live',
    );
    expect(network.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer sk_live_unit',
      'Idempotency-Key': 'checkout-attempt_live',
    });
  });

  it('opens a live portal while preserving its allowed billing policy', async () => {
    network.mockResolvedValueOnce(Response.json(portal)).mockResolvedValueOnce(
      Response.json({
        livemode: true,
        url: 'https://billing.stripe.com/live',
      }),
    );
    expect(await billing.createPortal('cus_live', 'en')).toBe(
      'https://billing.stripe.com/live',
    );
    const body = new URLSearchParams(String(network.mock.calls[1]?.[1]?.body));
    expect(body.get('configuration')).toBe('bpc_live');
    expect(body.get('return_url')).toBe(
      'https://vozzify.example/en/subscription',
    );
    network.mockResolvedValueOnce(
      Response.json({
        ...portal,
        features: {
          ...portal.features,
          subscription_update: { enabled: true },
        },
      }),
    );
    await expect(billing.createPortal('cus_live', 'en')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(network).toHaveBeenCalledTimes(3);
  });

  it('confirms a live trial card from the customer invoice settings', async () => {
    network
      .mockResolvedValueOnce(
        Response.json({ ...subscription, status: 'trialing', trial_end: end }),
      )
      .mockResolvedValueOnce(
        Response.json({
          livemode: true,
          invoice_settings: { default_payment_method: 'pm_live' },
          id: 'cus_live',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          type: 'card',
          livemode: true,
          customer: 'cus_live',
          id: 'pm_live',
        }),
      );
    expect(
      (await billing.getSubscription('sub_live')).default_payment_method,
    ).toBe('pm_live');
  });

  it('finds the first renewal failure in live event history', async () => {
    const now = Date.now() / 1000;
    network.mockResolvedValueOnce(
      Response.json({
        has_more: false,
        data: [
          {
            created: now - 30,
            id: 'evt_live',
            data: { object: { customer: 'cus_live', id: 'in_live' } },
            livemode: true,
          },
        ],
      }),
    );
    expect(
      await billing.firstInvoiceFailure({
        customer: 'cus_live',
        invoiceId: 'in_live',
        invoiceCreated: now - 3600,
        latestFailure: now,
      }),
    ).toBe(now - 30);
  });

  it('prepares, inspects and updates a live subscription schedule', async () => {
    network
      .mockResolvedValueOnce(Response.json(subscription))
      .mockResolvedValueOnce(
        Response.json({ id: 'sched_live', livemode: true }),
      )
      .mockResolvedValueOnce(Response.json(schedule))
      .mockResolvedValueOnce(Response.json(subscription))
      .mockResolvedValueOnce(Response.json(schedule))
      .mockResolvedValueOnce(Response.json(subscription))
      .mockResolvedValueOnce(Response.json(schedule))
      .mockResolvedValueOnce(Response.json(schedule));
    expect(await billing.prepareSchedule(input)).toBe('sched_live');
    const attached = { ...input, schedule: 'sched_live' };
    expect(await billing.inspectSchedule(attached)).toBe('pending');
    await billing.scheduleChange(attached);
    expect(network.mock.calls[7]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': 'change-live-change',
    });
  });

  it('releases live future phases when restoring the existing offer', async () => {
    network
      .mockResolvedValueOnce(
        Response.json({ ...subscription, schedule: 'sched_live' }),
      )
      .mockResolvedValueOnce(Response.json(schedule))
      .mockResolvedValueOnce(
        Response.json({
          livemode: true,
          id: 'sched_live',
          status: 'released',
          released_subscription: 'sub_live',
        }),
      );
    await billing.scheduleChange({
      ...input,
      schedule: 'sched_live',
      nextPrice: input.currentPrice,
      previousPrice: input.nextPrice,
      previousCycle: 'monthly',
    });
    expect(String(network.mock.calls[2]?.[0])).toBe(
      'https://api.stripe.com/v1/subscription_schedules/sched_live/release',
    );
  });
});
