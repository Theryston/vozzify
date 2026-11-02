import { parseStripeResponse, stripeModeSchema } from './stripe-mode.js';

describe('Stripe provider mode validation', () => {
  it.each([false, true])('preserves matching objects and pages: %s', (live) => {
    const key = live ? 'sk_live_unit' : 'sk_test_unit';
    const object = { id: 'obj_mode', livemode: live };
    expect(parseStripeResponse(object, key)).toEqual(object);
    const page = { data: [object], has_more: true };
    expect(parseStripeResponse(page, key)).toEqual(page);
    expect(parseStripeResponse({ data: [], has_more: false }, key)).toEqual({
      data: [],
      has_more: false,
    });
  });

  it.each([false, true])('rejects mismatched objects and pages: %s', (live) => {
    const key = live ? 'sk_live_unit' : 'sk_test_unit';
    const wrong = { id: 'obj_mode', livemode: !live };
    expect(() => parseStripeResponse(wrong, key)).toThrow();
    expect(() => parseStripeResponse({ ...wrong, data: [] }, key)).toThrow();
    expect(() =>
      parseStripeResponse({ livemode: live, data: [wrong] }, key),
    ).toThrow();
    expect(() =>
      parseStripeResponse(
        { data: [{ id: 'obj_valid', livemode: live }, wrong] },
        key,
      ),
    ).toThrow();
  });

  it.each([null, {}, { livemode: 'true' }, { data: [{}] }])(
    'rejects objects with missing or malformed mode',
    (object) => {
      expect(() => parseStripeResponse(object, 'sk_live_unit')).toThrow();
    },
  );

  it('keeps unconfigured webhook verification limited to test events', () => {
    expect(stripeModeSchema(undefined).safeParse(false).success).toBe(true);
    expect(stripeModeSchema(undefined).safeParse(true).success).toBe(false);
  });
});
