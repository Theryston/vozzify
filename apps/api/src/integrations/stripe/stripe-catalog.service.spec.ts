import { parseEnv } from '../../config/env.js';
import { StripeCatalogService } from './stripe-catalog.service.js';

const env = (secret = 'sk_test_unit') =>
  parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost',
    STRIPE_SECRET_KEY: secret,
  });
const copy = {
  en: { name: 'Studio', description: 'Practice tools.' },
  'pt-BR': { name: 'Studio BR', description: 'Localized tools.' },
};
const object = { id: 'prod_studio', livemode: false };

describe('Stripe catalog network boundary', () => {
  const network = vi.fn<typeof fetch>();
  beforeEach(() => {
    network.mockReset();
    vi.stubGlobal('fetch', network);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('creates a stable product with retryable identity and English source copy', async () => {
    network
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(Response.json(object));
    expect(
      await new StripeCatalogService(env()).syncProduct({
        planId: 'studio',
        copy,
        operationId: 'operation',
      }),
    ).toBe('prod_studio');
    expect(network).toHaveBeenLastCalledWith(
      'https://api.stripe.com/v1/products',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': 'operation-product-create',
        }),
        body: new URLSearchParams({
          id: 'nf_studio',
          name: 'Studio',
          description: 'Practice tools.',
        }).toString(),
      }),
    );
  });
  it('recovers an existing product with a separate update key', async () => {
    network
      .mockResolvedValueOnce(Response.json(object))
      .mockResolvedValueOnce(Response.json(object));
    await new StripeCatalogService(env()).syncProduct({
      planId: 'studio',
      copy,
      operationId: 'operation',
    });
    expect(network).toHaveBeenLastCalledWith(
      'https://api.stripe.com/v1/products/nf_studio',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'operation-product-update',
        }),
      }),
    );
  });
  it.each(['monthly', 'annual'] as const)(
    'creates immutable %s prices with durable lookup keys',
    async (cycle) => {
      network
        .mockResolvedValueOnce(Response.json({ data: [] }))
        .mockResolvedValueOnce(
          Response.json({ id: 'price_usd', livemode: false }),
        );
      expect(
        await new StripeCatalogService(env()).ensurePrice({
          cycle,
          currency: 'USD',
          amount: 500,
          productId: 'prod_studio',
          key: 'version-usd',
        }),
      ).toBe('price_usd');
      const options = network.mock.calls[1]?.[1];
      expect(
        new URLSearchParams(String(options?.body)).get('recurring[interval]'),
      ).toBe(cycle === 'annual' ? 'year' : 'month');
      expect(options?.body).toContain('unit_amount=500');
      expect(options?.body).toContain('lookup_key=version-usd');
    },
  );
  it('recovers by lookup key after Stripe idempotency retention expires', async () => {
    network.mockResolvedValueOnce(
      Response.json({ data: [{ id: 'price_existing', livemode: false }] }),
    );
    expect(
      await new StripeCatalogService(env()).ensurePrice({
        cycle: 'monthly',
        currency: 'BRL',
        amount: 2990,
        productId: 'prod_studio',
        key: 'durable-price',
      }),
    ).toBe('price_existing');
    expect(network).toHaveBeenCalledTimes(1);
    expect(String(network.mock.calls[0]?.[0])).toContain(
      'lookup_keys%5B%5D=durable-price',
    );
  });
  it('reports missing config and provider failures as recoverable', async () => {
    const input = { planId: 'studio', copy, operationId: 'operation' };
    await expect(
      new StripeCatalogService(env('')).syncProduct(input),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(network).not.toHaveBeenCalled();
    network.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(
      new StripeCatalogService(env()).syncProduct(input),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
  it.each([false, true])(
    'accepts matching credentials but refuses mismatched provider objects: %s',
    async (livemode) => {
      const secret = livemode ? 'sk_live_secret' : 'sk_test_secret';
      const config = env(secret);
      expect(config.STRIPE_SECRET_KEY).toBe(secret);
      network
        .mockResolvedValueOnce(Response.json({ ...object, livemode }))
        .mockResolvedValueOnce(
          Response.json({ ...object, livemode: !livemode }),
        );
      await expect(
        new StripeCatalogService(config).syncProduct({
          planId: 'studio',
          copy,
          operationId: 'operation',
        }),
      ).rejects.toThrow();
    },
  );
});
