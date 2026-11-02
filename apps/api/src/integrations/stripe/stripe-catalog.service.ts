import { Inject, Injectable } from '@nestjs/common';
import type { AdminPlanPrice, LocalizedCatalogCopy } from '@vozzify/contracts';
import { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';
import { ENV, type Env } from '../../config/env.js';
import { parseStripeResponse } from './stripe-mode.js';

const objectSchema = z.object({
  id: z.string().min(1),
  livemode: z.boolean(),
});

/** Only Stripe network operations live here; catalog policy stays in plans. */
@Injectable()
export class StripeCatalogService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async syncProduct(input: {
    planId: string;
    copy: LocalizedCatalogCopy;
    operationId: string;
  }): Promise<string> {
    const productId = `nf_${input.planId}`;
    const existing = await this.request(`products/${productId}`, 'GET');
    const fields = {
      name: input.copy.en.name,
      description: input.copy.en.description,
    };
    const response =
      existing === null
        ? await this.request(
            'products',
            'POST',
            { id: productId, ...fields },
            `${input.operationId}-product-create`,
          )
        : await this.request(
            `products/${productId}`,
            'POST',
            fields,
            `${input.operationId}-product-update`,
          );
    return objectSchema.parse(response).id;
  }

  async ensurePrice(
    input: AdminPlanPrice & { productId: string; key: string },
  ): Promise<string> {
    const query = new URLSearchParams({
      'lookup_keys[]': input.key,
      limit: '1',
    });
    const result = await this.request(`prices?${query}`, 'GET');
    const existing = z.object({ data: z.array(objectSchema) }).parse(result)
      .data[0];
    if (existing) return existing.id;
    const created = await this.request(
      'prices',
      'POST',
      {
        product: input.productId,
        currency: input.currency.toLowerCase(),
        unit_amount: String(input.amount),
        'recurring[interval]': input.cycle === 'annual' ? 'year' : 'month',
        lookup_key: input.key,
      },
      input.key,
    );
    return objectSchema.parse(created).id;
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, string>,
    key?: string,
  ): Promise<unknown> {
    const secret = this.env.STRIPE_SECRET_KEY;
    if (!secret)
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'Stripe configuration is missing',
      );
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...(body
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (method === 'GET' && response.status === 404) return null;
    if (!response.ok)
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'Stripe catalog synchronization failed',
      );
    return parseStripeResponse(await response.json(), secret);
  }
}
