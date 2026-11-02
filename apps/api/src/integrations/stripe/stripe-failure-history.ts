import { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';

type FailureQuery = {
  invoiceId: string;
  customer: string;
  invoiceCreated: number;
  latestFailure: number;
};
const pageSchema = z.object({
  has_more: z.boolean(),
  data: z.array(
    z.object({
      id: z.string(),
      created: z.number(),
      livemode: z.boolean(),
      data: z.object({
        object: z.object({ id: z.string(), customer: z.string().nullable() }),
      }),
    }),
  ),
});

function earliestOnPage(
  input: FailureQuery,
  page: z.infer<typeof pageSchema>,
  earliest: number | undefined,
) {
  for (const event of page.data) {
    if (
      event.data.object.id === input.invoiceId &&
      event.data.object.customer === input.customer
    )
      earliest = Math.min(earliest ?? event.created, event.created);
  }
  return earliest;
}

export async function firstInvoiceFailure(
  input: FailureQuery,
  request: (path: string) => Promise<unknown>,
): Promise<number> {
  if (
    input.invoiceCreated < Date.now() / 1000 - 30 * 86400 ||
    input.invoiceCreated > input.latestFailure
  )
    throw new AppException(
      'SERVICE_UNAVAILABLE',
      'Stripe failure history is incomplete',
    );
  let cursor: string | undefined;
  let earliest: number | undefined;
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const query = new URLSearchParams({
      type: 'invoice.payment_failed',
      limit: '100',
      'created[gte]': String(input.invoiceCreated),
      'created[lte]': String(input.latestFailure),
      ...(cursor ? { starting_after: cursor } : {}),
    });
    const page = pageSchema.parse(await request(`events?${query}`));
    earliest = earliestOnPage(input, page, earliest);
    if (!page.has_more) {
      if (earliest !== undefined) return earliest;
      break;
    }
    cursor = page.data.at(-1)?.id;
    if (!cursor) break;
  }
  throw new AppException(
    'SERVICE_UNAVAILABLE',
    'Stripe failure history is incomplete',
  );
}
