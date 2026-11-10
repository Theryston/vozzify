import { homeFeedPageSchema } from '@vozzify/contracts';
import request from 'supertest';
import { useAuthSpec } from './utils/auth-spec.js';
import {
  rowPinBody,
  signInPinsAdmin,
} from './utils/editorial-pin-factories.js';
import {
  sharedInMemoryCache,
  withInMemoryCache,
} from './utils/in-memory-cache.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const PINS = '/v1/admin/home-pins';

describe('48-Track Pin continuation lifecycle (e2e)', () => {
  const spec = useAuthSpec({ override: withInMemoryCache });

  beforeEach(async () => {
    sharedInMemoryCache.clear();
    await signInPinsAdmin(spec.testApp.db, spec.client);
  });

  it.each(['order', 'eligibility'] as const)(
    'invalidates visitor and personal continuations after a live %s change',
    async (change) => {
      const ids = await Promise.all(
        Array.from({ length: 48 }, async (_, index) => {
          const track = await createCompletedTrack(spec.testApp.db, {
            title: `Live editorial ${index}`,
          });
          return track.id;
        }),
      );
      const created = await spec.client
        .post(PINS)
        .send(rowPinBody(ids))
        .expect(201);
      const visitor = request(spec.testApp.app.getHttpServer());
      const clients = [visitor, spec.client];
      const paths: string[] = [];
      for (const client of clients) {
        const response = await client.get('/v1/home?locale=en').expect(200);
        const feed = homeFeedPageSchema.parse(response.body);
        const row = feed.rows.find(
          (candidate) => candidate.id === `pin-${created.body.id}`,
        );
        if (row?.layout !== 'standard' || !row.nextItemsCursor) {
          throw new Error('The long editorial Row has no continuation');
        }
        paths.push(
          `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(row.nextItemsCursor)}`,
        );
      }
      await spec.client
        .patch(`${PINS}/${created.body.id}`)
        .send(
          change === 'order'
            ? { source: { type: 'tracks', trackIds: [...ids].reverse() } }
            : { locale: 'pt-BR' },
        )
        .expect(200);

      for (const [index, client] of clients.entries()) {
        const response = await client.get(paths[index] ?? '').expect(404);
        expect(response.body).toMatchObject({
          code: 'NOT_FOUND',
          details: { reason: 'FEED_VERSION_EXPIRED' },
        });
        expect(response.body.items).toBeUndefined();
      }

      const fresh = await visitor.get('/v1/home?locale=en').expect(200);
      const row = homeFeedPageSchema
        .parse(fresh.body)
        .rows.find((candidate) => candidate.id === `pin-${created.body.id}`);
      if (change === 'eligibility') {
        expect(row).toBeUndefined();
      } else {
        expect(
          row?.layout === 'standard' && row.items.map(({ id }) => id),
        ).toEqual([...ids].reverse().slice(0, 12));
      }
    },
    30_000,
  );
});
