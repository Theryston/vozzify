import request from 'supertest';
import {
  createAlbumDisc,
  placeAlbumTrack,
} from './utils/album-track-factories.js';
import { useAuthSpec } from './utils/auth-spec.js';
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
} from './utils/factories.js';
import {
  sharedInMemoryCache,
  withInMemoryCache,
} from './utils/in-memory-cache.js';
import { createCompletedTrack } from './utils/track-processing-factories.js';

const PINS = '/v1/admin/home-pins';
const spec = useAuthSpec({ override: withInMemoryCache });

type TrackCard = { id: string };
type HomeRow = {
  id: string;
  items?: TrackCard[];
  nextItemsCursor?: string | null;
};
type ItemPage = { items: TrackCard[]; nextCursor: string | null };

describe('48-Track editorial Pins (e2e)', () => {
  beforeEach(async () => {
    sharedInMemoryCache.clear();
    await signInPinsAdmin(spec.testApp.db, spec.client);
  });

  const createPin = async (body: Record<string, unknown>): Promise<string> => {
    const response = await spec.client.post(PINS).send(body).expect(201);
    return response.body.id as string;
  };

  const findRow = (rows: HomeRow[], pinId: string): HomeRow => {
    const row = rows.find((candidate) => candidate.id === `pin-${pinId}`);
    if (!row) throw new Error('The editorial Row was not present in Home');
    return row;
  };

  const readPages = async (
    row: HomeRow,
    signedIn: boolean,
  ): Promise<{ ids: string[]; sizes: number[] }> => {
    const ids = (row.items ?? []).map((item) => item.id);
    const sizes = [ids.length];
    let cursor = row.nextItemsCursor;
    while (cursor) {
      const path = `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(cursor)}`;
      const response = signedIn
        ? await spec.client.get(path).expect(200)
        : await request(spec.testApp.app.getHttpServer()).get(path).expect(200);
      const page = response.body as ItemPage;
      ids.push(...page.items.map((item) => item.id));
      sizes.push(page.items.length);
      cursor = page.nextCursor;
    }
    return { ids, sizes };
  };

  it('delivers four pages of 12 Tracks to visitors and signed-in Users', async () => {
    const trackIds = await Promise.all(
      Array.from({ length: 48 }, async (_, index) => {
        const track = await createCompletedTrack(spec.testApp.db, {
          title: `Editorial Track ${index}`,
          coverUrl: `https://cdn.example/editorial-${index}.webp`,
        });
        return track.id;
      }),
    );
    const pinId = await createPin(rowPinBody(trackIds, { position: 1 }));

    const visitorResponse = await request(spec.testApp.app.getHttpServer())
      .get('/v1/home?locale=en')
      .expect(200);
    const personalResponse = await spec.client.get('/v1/home').expect(200);
    const visitor = findRow(visitorResponse.body.rows as HomeRow[], pinId);
    const personal = findRow(personalResponse.body.rows as HomeRow[], pinId);
    const [visitorPages, personalPages] = await Promise.all([
      readPages(visitor, false),
      readPages(personal, true),
    ]);

    expect(visitorPages.sizes).toEqual([12, 12, 12, 12]);
    expect(personalPages.sizes).toEqual([12, 12, 12, 12]);
    expect(visitorPages.ids).toEqual(trackIds);
    expect(personalPages.ids).toEqual(trackIds);
  }, 30_000);

  it('resolves each dynamic source to 48 Tracks in its established order', async () => {
    const trackIds = await Promise.all(
      Array.from({ length: 48 }, async (_, index) => {
        const track = await createCompletedTrack(spec.testApp.db, {
          title: `Source Track ${index}`,
          trendingScore: 1_000 - index,
          genres: ['rock'],
        });
        return track.id;
      }),
    );
    const artist = await createArtist(spec.testApp.db, {
      name: 'Source Artist',
    });
    await Promise.all(
      trackIds.map((trackId) =>
        linkTrackArtist(spec.testApp.db, trackId, artist.id),
      ),
    );
    const album = await createAlbum(spec.testApp.db, { title: 'Source Album' });
    await createAlbumDisc(spec.testApp.db, album.id, 1);
    const albumOrder = [...trackIds].reverse();
    await Promise.all(
      albumOrder.map((trackId, index) =>
        placeAlbumTrack(spec.testApp.db, {
          albumId: album.id,
          trackId,
          discPosition: 1,
          trackPosition: index + 1,
        }),
      ),
    );

    for (const [body, expectedIds] of [
      [genrePinBody('rock'), trackIds],
      [artistPinBody(artist.id), trackIds],
      [albumPinBody(album.id), albumOrder],
    ] as const) {
      const pinId = await createPin(body);
      const response = await request(spec.testApp.app.getHttpServer())
        .get('/v1/home?locale=en')
        .expect(200);
      const row = findRow(response.body.rows as HomeRow[], pinId);
      const pages = await readPages(row, false);

      expect(pages.sizes).toEqual([12, 12, 12, 12]);
      expect(pages.ids).toEqual(expectedIds);
      await spec.client.delete(`${PINS}/${pinId}`).expect(204);
    }
  }, 30_000);
});
