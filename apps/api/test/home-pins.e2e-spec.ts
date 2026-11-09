import { eq } from 'drizzle-orm';
import request from 'supertest';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import {
  createAlbumDisc,
  placeAlbumTrack,
} from './utils/album-track-factories.js';
import { type AuthClient, createAuthClient } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  albumPinBody,
  artistPinBody,
  genrePinBody,
  rowPinBody,
  signInPinsAdmin,
} from './utils/editorial-pin-factories.js';
import {
  createAlbum,
  createArtist,
  linkTrackArtist,
  testMbid,
} from './utils/factories.js';
import {
  sharedInMemoryCache,
  withInMemoryCache,
} from './utils/in-memory-cache.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const PINS = '/v1/admin/home-pins';
const HOUR_MS = 3_600_000;

/**
 * Twenty completed Tracks with covers, hottest first, each by its own artist
 * (so the artist cap never trims a row). The first is the hero, the next
 * twelve the trending row, and the rest the new Tracks row.
 */
const seedTracks = async (db: Parameters<typeof createCompletedTrack>[0]) => {
  const ids: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    const track = await createCompletedTrack(db, {
      title: `Track ${i}`,
      coverUrl: `https://cdn.example/track-${i}.webp`,
      trendingScore: 100 - i,
      artistCredit: [{ name: `Artist ${i}`, joinPhrase: '' }],
    });
    ids.push(track.id);
  }
  return ids;
};

type Row = {
  id: string;
  layout: string;
  sponsored?: boolean;
  title?: { key: string; params: Record<string, string | number> };
  track?: { id: string };
  items?: { id: string }[];
};

describe('Home feed with editorial pins (e2e)', () => {
  // An in-memory cache keeps the stored feed between requests, so the cursors
  // of a visit resolve to the feed they were issued for.
  let testApp: TestApp;
  let client: AuthClient;

  beforeAll(async () => {
    testApp = await createTestApp({ override: withInMemoryCache });
  });

  afterAll(async () => {
    await testApp.close();
  });
  let ids: string[] = [];

  /** The public feed as a visitor who is not signed in gets it. */
  const visitorRows = async (locale = 'en'): Promise<Row[]> => {
    const response = await request(testApp.app.getHttpServer())
      .get(`/v1/home?locale=${locale}`)
      .expect(200);
    return response.body.rows as Row[];
  };

  /** The same feed as the signed-in admin (a signed-in User) gets it. */
  const signedInRows = async (): Promise<Row[]> => {
    const response = await client.get('/v1/home').expect(200);
    return response.body.rows as Row[];
  };

  const createPin = async (body: Record<string, unknown>): Promise<string> => {
    const response = await client.post(PINS).send(body).expect(201);
    return response.body.id as string;
  };

  const itemIds = (row: Row | undefined): string[] =>
    (row?.items ?? []).map((item) => item.id);

  beforeEach(async () => {
    await resetDatabase(testApp.db);
    sharedInMemoryCache.clear();
    client = createAuthClient(testApp);
    ids = await seedTracks(testApp.db);
    await signInPinsAdmin(testApp.db, client);
  });

  it('shows the algorithmic feed when no pin is live', async () => {
    const rows = await visitorRows();

    expect(rows.map((row) => row.layout)).toEqual([
      'hero',
      'standard',
      'standard',
    ]);
    expect(rows[0]?.track?.id).toBe(ids[0]);
  });

  it('places a pinned row at its position, in the admin order, without the sponsored flag', async () => {
    const pinId = await createPin(
      rowPinBody([ids[15] ?? '', ids[16] ?? '', ids[17] ?? ''], {
        position: 1,
      }),
    );

    const rows = await visitorRows();

    expect(rows[1]).toMatchObject({
      id: `pin-${pinId}`,
      layout: 'standard',
      title: { key: 'home.rows.pinned', params: { title: 'Festive' } },
    });
    expect(itemIds(rows[1])).toEqual([ids[15], ids[16], ids[17]]);
    expect(rows[1]).not.toHaveProperty('sponsored');
  });

  it('keeps a pinned Track out of the algorithmic rows', async () => {
    await createPin(rowPinBody([ids[3] ?? '', ids[4] ?? '']));

    const rows = await visitorRows();
    const trending = rows.find((row) => row.id === 'trending-today');

    expect(itemIds(trending)).not.toContain(ids[3]);
    expect(itemIds(trending)).not.toContain(ids[4]);
  });

  it('marks a sponsored pin for visitors and signed-in Users alike', async () => {
    const pinId = await createPin(
      rowPinBody([ids[15] ?? ''], { sponsored: true }),
    );

    const visitor = (await visitorRows()).find(
      (row) => row.id === `pin-${pinId}`,
    );
    const signedIn = (await signedInRows()).find(
      (row) => row.id === `pin-${pinId}`,
    );

    expect(visitor).toMatchObject({ sponsored: true });
    expect(signedIn).toMatchObject({ sponsored: true });
  });

  it('shows a visitors-only pin to visitors and not to signed-in Users', async () => {
    const pinId = await createPin(
      rowPinBody([ids[15] ?? ''], { audience: 'visitors' }),
    );

    expect((await visitorRows()).map((row) => row.id)).toContain(
      `pin-${pinId}`,
    );
    expect((await signedInRows()).map((row) => row.id)).not.toContain(
      `pin-${pinId}`,
    );
  });

  it('shows a locale-limited pin only in its locale', async () => {
    const pinId = await createPin(
      rowPinBody([ids[15] ?? ''], { locale: 'pt-BR' }),
    );

    expect((await visitorRows('en')).map((row) => row.id)).not.toContain(
      `pin-${pinId}`,
    );
    const portuguese = (await visitorRows('pt-BR')).find(
      (row) => row.id === `pin-${pinId}`,
    );
    expect(portuguese?.title).toEqual({
      key: 'home.rows.pinned',
      params: { title: 'Festivo' },
    });
  });

  it('shows a time-boxed pin only inside its window', async () => {
    const now = Date.now();
    const iso = (offset: number) => new Date(now + offset).toISOString();
    const upcoming = await createPin(
      rowPinBody([ids[12] ?? ''], {
        startsAt: iso(HOUR_MS),
        endsAt: iso(2 * HOUR_MS),
      }),
    );
    const live = await createPin(
      rowPinBody([ids[13] ?? ''], {
        startsAt: iso(-HOUR_MS),
        endsAt: iso(HOUR_MS),
        priority: 3,
      }),
    );
    const ended = await createPin(
      rowPinBody([ids[14] ?? ''], {
        startsAt: iso(-2 * HOUR_MS),
        endsAt: iso(-HOUR_MS),
        priority: 4,
      }),
    );

    const shown = (await visitorRows()).map((row) => row.id);

    expect(shown).toContain(`pin-${live}`);
    expect(shown).not.toContain(`pin-${upcoming}`);
    expect(shown).not.toContain(`pin-${ended}`);
  });

  it('gives the position to the higher priority pin and moves the other one down', async () => {
    const low = await createPin(rowPinBody([ids[15] ?? ''], { priority: 0 }));
    const high = await createPin(rowPinBody([ids[16] ?? ''], { priority: 5 }));

    const rows = await visitorRows();

    expect(rows[1]?.id).toBe(`pin-${high}`);
    expect(rows[2]?.id).toBe(`pin-${low}`);
  });

  it('shows a pinned hero in the hero slot, sponsored when its pin is', async () => {
    const pinId = await createPin(
      rowPinBody([ids[5] ?? ''], {
        kind: 'hero',
        layout: 'hero',
        position: 0,
        sponsored: true,
      }),
    );

    const rows = await visitorRows();

    expect(rows[0]).toMatchObject({
      id: `pin-${pinId}`,
      layout: 'hero',
      sponsored: true,
      track: { id: ids[5] },
    });
  });

  it('skips a pinned Track that is no longer completed, at read time', async () => {
    const pinId = await createPin(rowPinBody([ids[16] ?? '', ids[17] ?? '']));
    const db = testApp.db;
    await db
      .update(trackProcessings)
      .set({ status: 'QUEUED' })
      .where(eq(trackProcessings.trackId, ids[16] ?? ''));

    const rows = await visitorRows();

    expect(rows.find((row) => row.id === `pin-${pinId}`)?.items).toEqual([
      expect.objectContaining({ id: ids[17] }),
    ]);
  });

  it('overlays a cursor page with the pins of the locale its feed was built for, without a locale parameter', async () => {
    for (let position = 1; position <= 7; position += 1) {
      await createPin(
        rowPinBody([ids[position + 10] ?? ''], {
          position,
          titles: {
            en: `English ${position}`,
            'pt-BR': `Portugues ${position}`,
          },
        }),
      );
    }
    const server = request(testApp.app.getHttpServer());
    const first = await server.get('/v1/home?locale=pt-BR').expect(200);
    expect(first.body.nextCursor).not.toBeNull();

    // The second page is served with no locale parameter: it must still carry
    // the Portuguese pins its feed was built with, not the English ones.
    const second = await server
      .get(`/v1/home?cursor=${first.body.nextCursor}`)
      .expect(200);

    const pinnedTitles = (second.body.rows as Row[])
      .filter((row) => row.title?.key === 'home.rows.pinned')
      .map((row) => row.title?.params.title);
    expect(pinnedTitles).toEqual(['Portugues 6', 'Portugues 7']);
  });

  it('brings the algorithm back once the pin is removed', async () => {
    const pinId = await createPin(rowPinBody([ids[3] ?? '']));

    await client.delete(`${PINS}/${pinId}`).expect(204);
    const rows = await visitorRows();

    expect(rows.map((row) => row.id)).not.toContain(`pin-${pinId}`);
    expect(rows[1]?.id).toBe('trending-today');
    expect(itemIds(rows[1])).toContain(ids[3]);
  });

  it('fills a genre pin with the best eligible Tracks, out of the other rows', async () => {
    const pinId = await createPin(genrePinBody('rock'));

    const first = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    const rows = first.body.rows as Row[];
    const pinned = rows.find((row) => row.id === `pin-${pinId}`);
    const cursor = (
      pinned as (Row & { nextItemsCursor?: string | null }) | undefined
    )?.nextItemsCursor;

    expect(itemIds(pinned)).toHaveLength(12);
    expect(cursor).toEqual(expect.any(String));
    const later = await request(testApp.app.getHttpServer())
      .get(
        `/v1/home/rows/${pinned?.id}/items?cursor=${encodeURIComponent(cursor ?? '')}`,
      )
      .expect(200);
    expect(later.body.items).toHaveLength(8);
    expect(later.body.nextCursor).toBeNull();
    // Every seeded Track is rock, hottest first, so the pin holds them all.
    expect([
      ...itemIds(pinned),
      ...(later.body.items as { id: string }[]).map((item) => item.id),
    ]).toEqual(ids);
    expect(rows.find((row) => row.id === 'trending-today')).toBeUndefined();
  });

  it("lists an artist pin with the Artist's best Tracks", async () => {
    const artist = await createArtist(testApp.db, { name: 'Featured' });
    const picked = [ids[12], ids[3], ids[9], ids[1], ids[15], ids[6]];
    for (const id of picked) {
      await linkTrackArtist(testApp.db, id ?? '', artist.id);
    }
    const pinId = await createPin(artistPinBody(artist.id));

    const rows = await visitorRows();
    const pinned = rows.find((row) => row.id === `pin-${pinId}`);

    // The Artist's Tracks, hottest first, wherever they were picked from.
    expect(itemIds(pinned)).toEqual(
      [...picked].sort((a, b) => ids.indexOf(a ?? '') - ids.indexOf(b ?? '')),
    );
  });

  it('follows the album order for an album pin', async () => {
    const album = await createAlbum(testApp.db, { title: 'Featured album' });
    await createAlbumDisc(testApp.db, album.id, 1);
    const order = [ids[9], ids[2], ids[17], ids[5], ids[11], ids[0]];
    for (const [index, id] of order.entries()) {
      await placeAlbumTrack(testApp.db, {
        albumId: album.id,
        trackId: id ?? '',
        discPosition: 1,
        trackPosition: index + 1,
      });
    }
    const pinId = await createPin(albumPinBody(album.id));

    const rows = await visitorRows();
    const pinned = rows.find((row) => row.id === `pin-${pinId}`);

    expect(itemIds(pinned)).toEqual(order);
  });

  it('shows a newly processed Track of the genre without editing the pin', async () => {
    const pinId = await createPin(genrePinBody('rock'));
    const fresh = await createCompletedTrack(testApp.db, {
      title: 'Fresh hit',
      trendingScore: 1000,
    });

    const rows = await visitorRows();
    const pinned = rows.find((row) => row.id === `pin-${pinId}`);

    expect(itemIds(pinned)[0]).toBe(fresh.id);
  });

  it('skips a genre Track that is no longer completed, at read time', async () => {
    const pinId = await createPin(genrePinBody('rock'));
    const db = testApp.db;
    await db
      .update(trackProcessings)
      .set({ status: 'QUEUED' })
      .where(eq(trackProcessings.trackId, ids[0] ?? ''));

    const first = await request(testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    const rows = first.body.rows as Row[];
    const pinned = rows.find((row) => row.id === `pin-${pinId}`);
    const cursor = (
      pinned as (Row & { nextItemsCursor?: string | null }) | undefined
    )?.nextItemsCursor;
    expect(itemIds(pinned)).toHaveLength(12);
    expect(cursor).toEqual(expect.any(String));
    const later = await request(testApp.app.getHttpServer())
      .get(
        `/v1/home/rows/${pinned?.id}/items?cursor=${encodeURIComponent(cursor ?? '')}`,
      )
      .expect(200);
    expect(later.body.items).toHaveLength(7);
    expect(later.body.nextCursor).toBeNull();
    expect([
      ...itemIds(pinned),
      ...(later.body.items as { id: string }[]).map((item) => item.id),
    ]).toEqual(ids.slice(1));
  });

  it('links served credits to their Artist page, null when unknown', async () => {
    const artistMbid = testMbid(4242);
    const artist = await createArtist(testApp.db, {
      name: 'Linked Artist',
      mbid: artistMbid,
    });
    const linked = await createCompletedTrack(testApp.db, {
      title: 'Linked hit',
      coverUrl: 'https://cdn.example/linked.webp',
      trendingScore: 1000,
      artistCredit: [
        { name: 'Linked Artist', joinPhrase: '', mbid: artistMbid },
      ],
    });
    await linkTrackArtist(testApp.db, linked.id, artist.id);

    const rows = await visitorRows();
    const hero = rows.find((row) => row.layout === 'hero') as
      | {
          track?: {
            id?: string;
            artistCredit?: { name?: string; artistId?: string | null }[];
          };
        }
      | undefined;

    expect(hero?.track?.id).toBe(linked.id);
    expect(hero?.track?.artistCredit).toEqual([
      { name: 'Linked Artist', joinPhrase: '', artistId: artist.id },
    ]);
    const standard = rows.find((row) => row.layout === 'standard') as
      | { items?: { artistCredit?: { artistId?: string | null }[] }[] }
      | undefined;
    expect(standard?.items?.[0]?.artistCredit).toEqual([
      { name: expect.any(String), joinPhrase: '', artistId: null },
    ]);
  });
});
