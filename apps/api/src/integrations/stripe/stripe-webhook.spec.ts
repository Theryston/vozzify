import { createHmac } from 'node:crypto';
import { verifyStripeEvent } from './stripe-webhook.js';

const secret = 'whsec_unit_test_only';
const signedEvent = (livemode: boolean) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      id: 'evt_mode',
      type: 'invoice.paid',
      livemode,
      data: { object: { id: 'in_mode', customer: 'cus_mode' } },
    }),
  );
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex');
  return { body, signature: `t=${timestamp},v1=${digest}`, secret };
};

describe('Stripe webhook account mode', () => {
  it.each([false, true])('accepts a signed matching mode: %s', (livemode) => {
    expect(
      verifyStripeEvent({
        ...signedEvent(livemode),
        apiKey: livemode ? 'sk_live_unit' : 'sk_test_unit',
      }),
    ).toMatchObject({ id: 'evt_mode', livemode });
  });

  it.each([false, true])('rejects a signed mismatched mode: %s', (livemode) => {
    expect(() =>
      verifyStripeEvent({
        ...signedEvent(livemode),
        apiKey: livemode ? 'sk_test_unit' : 'sk_live_unit',
      }),
    ).toThrow('Invalid Stripe event');
  });

  it('retains signature verification for live events', () => {
    expect(() =>
      verifyStripeEvent({
        ...signedEvent(true),
        apiKey: 'sk_live_unit',
        signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
      }),
    ).toThrow('Invalid Stripe signature');
  });
});
