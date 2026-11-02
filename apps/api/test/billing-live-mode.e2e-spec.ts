import { createHmac } from 'node:crypto';
import { SubscriptionsService } from '../src/modules/plans/subscriptions.service.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';

const secret = 'whsec_live_mode_endpoint_fixture';
const event = (livemode: boolean) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    type: 'customer.subscription.updated',
    data: { object: { customer: 'cus_live_mode' } },
    livemode,
    id: 'evt_live_mode',
  });
  return {
    body,
    signature: `t=${timestamp},v1=${createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')}`,
  };
};

describe('Live Stripe webhook mode (e2e)', () => {
  let app: TestApp;
  const webhook = vi.fn().mockResolvedValue(undefined);
  beforeAll(async () => {
    app = await createTestApp({
      env: {
        STRIPE_SECRET_KEY: 'sk_live_endpointfixture',
        STRIPE_WEBHOOK_SECRET: secret,
      },
      override: (builder) =>
        builder.overrideProvider(SubscriptionsService).useValue({ webhook }),
    });
  });
  beforeEach(() => webhook.mockClear());
  afterAll(async () => app.close());

  const deliver = (livemode: boolean) => {
    const signed = event(livemode);
    return app.http
      .post('/v1/billing/stripe-webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signed.signature)
      .send(signed.body);
  };

  it('forwards a signed live event to the subscription service', async () => {
    await deliver(true).expect(200);
    expect(webhook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'evt_live_mode', livemode: true }),
    );
  });

  it('rejects a signed test event before subscription processing', async () => {
    await deliver(false).expect(400);
    expect(webhook).not.toHaveBeenCalled();
  });
});
