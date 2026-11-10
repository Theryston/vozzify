import { homeFeedPageSchema, homeRowItemsPageSchema } from '@vozzify/contracts';
import { inArray } from 'drizzle-orm';
import { practiceAttempts } from '../src/database/schema/practice-attempts.js';
import { trackFavorites } from '../src/database/schema/track-favorites.js';
import { trackProcessings } from '../src/database/schema/track-processings.js';
import { tracks } from '../src/database/schema/tracks.js';
import { HomeFeedService } from '../src/modules/home/home-feed.service.js';
import { PersonalHomeRepository } from '../src/modules/home/home-personal.repository.js';
import { PersonalHomeStore } from '../src/modules/home/home-personal.store.js';
import { PersonalHomeBuilder } from '../src/modules/home/home-personal-builder.service.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  createCredentialAccount,
  createUser,
  DEFAULT_PASSWORD,
  testMbid,
} from './utils/factories.js';
import { attemptValue } from './utils/home-personal-discovery-fixtures.js';
import {
  sharedInMemoryCache,
  withInMemoryCache,
} from './utils/in-memory-cache.js';

const collectItems = async (
  client: ReturnType<typeof createAuthClient>,
  row: { id: string; items: { id: string }[]; nextItemsCursor?: string | null },
) => {
  const lengths = [row.items.length];
  const ids = row.items.map(({ id }) => id);
  let cursor: string | null = row.nextItemsCursor ?? null;
  while (cursor) {
    const response = await client
      .get(`/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(cursor)}`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const page = homeRowItemsPageSchema.parse(response.body);
    expect(page.items.length).toBeLessThanOrEqual(12);
    lengths.push(page.items.length);
    ids.push(...page.items.map(({ id }) => id));
    cursor = page.nextCursor;
  }
  expect(new Set(ids).size).toBe(ids.length);
  return { lengths, ids };
};

describe('personal carousel capacity (e2e)', () => {
  let testApp: TestApp;
  beforeAll(async () => {
    testApp = await createTestApp({ override: withInMemoryCache });
  });
  afterAll(async () => testApp.close());
  beforeEach(async () => {
    sharedInMemoryCache.clear();
    await resetDatabase(testApp.db);
  });

  const seed = async (count = 180, uniqueArtists = false) => {
    const records = await testApp.db
      .insert(tracks)
      .values(
        Array.from({ length: count }, (_, index) => ({
          recordingMbid: testMbid(90_000 + index),
          title: `Capacity ${index}`,
          artistCredit: [
            {
              name: `Artist ${uniqueArtists ? index : index % 30}`,
              joinPhrase: '',
            },
          ],
          genres: ['rock'],
          trendingScore: 1000 - index,
          lengthMs: 180_000,
        })),
      )
      .returning();
    await testApp.db.insert(trackProcessings).values(
      records.map((track) => ({
        trackId: track.id,
        status: 'COMPLETED' as const,
      })),
    );
    const user = await createUser(testApp.db, {
      username: 'capacity_singer',
      email: 'capacity@example.com',
    });
    await createCredentialAccount(testApp.db, user);
    const client = createAuthClient(testApp);
    await signIn(client, {
      email: user.email,
      password: DEFAULT_PASSWORD,
    }).expect(200);
    return { records, user, client };
  };
  const refresh = async (userId: string) => {
    const feed = await testApp.app.get(PersonalHomeBuilder).build(userId, 'en');
    await testApp.app.get(PersonalHomeStore).writeCurrent(userId, 'en', feed);
    return feed;
  };

  type CapacityRecords = Awaited<ReturnType<typeof seed>>['records'];
  const setVoiceRanges = async (
    records: CapacityRecords,
    withinCount: number,
  ) => {
    await testApp.db
      .update(tracks)
      .set({ vocalRangeLowest: 60, vocalRangeHighest: 68 })
      .where(
        inArray(
          tracks.id,
          records.slice(0, withinCount).map(({ id }) => id),
        ),
      );
    await testApp.db
      .update(tracks)
      .set({ vocalRangeLowest: 59, vocalRangeHighest: 69 })
      .where(
        inArray(
          tracks.id,
          records.slice(withinCount).map(({ id }) => id),
        ),
      );
  };
  const seedCoordinatedHistory = async (
    userId: string,
    history: CapacityRecords,
    masteredFrom = history.length,
  ) => {
    await testApp.db.update(tracks).set({ genres: [] });
    await testApp.db
      .update(tracks)
      .set({ trendingScore: 0 })
      .where(
        inArray(
          tracks.id,
          history.map(({ id }) => id),
        ),
      );
    await testApp.db
      .insert(practiceAttempts)
      .values(
        history.map((track, index) =>
          attemptValue(
            userId,
            track.id,
            index < masteredFrom ? 0.7 : 0.95,
            new Date(Date.now() - index * 1000),
          ),
        ),
      );
  };

  it('exposes expanded no-history fallback and favorite-only personal recommendations privately', async () => {
    const { records, user, client } = await seed();
    const fallback = homeFeedPageSchema.parse(
      (await client.get('/v1/home?locale=en').expect(200)).body,
    );
    const expandedFallback = fallback.rows.find(
      (row) => row.layout === 'standard' && row.nextItemsCursor,
    );
    if (expandedFallback?.layout !== 'standard')
      throw new Error('Missing expanded fallback');
    expect((await collectItems(client, expandedFallback)).ids).toHaveLength(48);
    const favorite = records[0];
    if (!favorite) throw new Error('Missing favorite');
    await testApp.db
      .insert(trackFavorites)
      .values({ userId: user.id, trackId: favorite.id });
    const feed = await refresh(user.id);
    const expanded = feed.rows.find(
      (row) => row.layout === 'standard' && row.items.length === 48,
    );
    expect(expanded).toBeDefined();
    for (const row of feed.rows) {
      if (row.layout !== 'standard') continue;
      for (let offset = 0; offset < row.items.length; offset += 12) {
        const batch = row.items.slice(offset, offset + 12);
        const names = batch.flatMap((track) =>
          track.artistCredit.map(({ name }) => name),
        );
        expect(
          names.every(
            (name) =>
              names.filter((candidate) => candidate === name).length <= 2,
          ),
        ).toBe(true);
      }
    }
    const response = await client.get('/v1/home?locale=en').expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const page = homeFeedPageSchema.parse(response.body);
    const row = page.rows.find((candidate) => candidate.id === expanded?.id);
    if (row?.layout !== 'standard' || !row.nextItemsCursor)
      throw new Error('Missing personal continuation');
    expect((await collectItems(client, row)).ids).toHaveLength(48);
    const stranger = createAuthClient(testApp);
    await stranger
      .get(
        `/v1/home/rows/${row.id}/items?cursor=${encodeURIComponent(row.nextItemsCursor)}`,
      )
      .expect(404);
  });

  it('retains 25 resume Tracks as 12, 12 and 1 across a regeneration', async () => {
    const { records, user, client } = await seed();
    const history = records.slice(0, 25);
    await testApp.db
      .insert(practiceAttempts)
      .values(
        history.map((track, index) =>
          attemptValue(
            user.id,
            track.id,
            0.95,
            new Date(Date.now() - index * 86_400_000),
          ),
        ),
      );
    const feed = await refresh(user.id);
    expect(feed.rows.find(({ id }) => id === 'sing-again')).toMatchObject({
      items: expect.any(Array),
    });
    const first = homeFeedPageSchema.parse(
      (await client.get('/v1/home?locale=en').expect(200)).body,
    );
    const resume = first.rows.find(({ id }) => id === 'sing-again');
    if (resume?.layout !== 'standard') throw new Error('Missing resume');
    await refresh(user.id);
    const observed = await collectItems(client, resume);
    expect(observed.lengths).toEqual([12, 12, 1]);
    expect(observed.ids).toEqual(history.map(({ id }) => id));
  });
  it('expands evidence-qualified voice Rows without mixing fit and challenge candidates', async () => {
    const { records, user, client } = await seed();
    await setVoiceRanges(records, 90);
    const reference = records[0];
    if (!reference) throw new Error('Missing reference');
    await testApp.db
      .insert(practiceAttempts)
      .values(attemptValue(user.id, reference.id, 0.95, new Date()));
    const feed = await refresh(user.id);
    for (const id of ['within-your-voice', 'challenge-your-range']) {
      const stored = feed.rows.find((row) => row.id === id);
      if (stored?.layout !== 'vocal-range') throw new Error(`Missing ${id}`);
      expect(stored.items).toHaveLength(48);
      expect(
        stored.items.every(
          (track) =>
            track.vocalRange.lowest === (id === 'within-your-voice' ? 60 : 59),
        ),
      ).toBe(true);
    }
    const first = homeFeedPageSchema.parse(
      (await client.get('/v1/home?locale=en').expect(200)).body,
    );
    const within = first.rows.find(({ id }) => id === 'within-your-voice');
    if (within?.layout !== 'vocal-range') throw new Error('Missing voice page');
    expect(within.items.every((track) => track.fitsVoice === true)).toBe(true);
    expect((await collectItems(client, within)).ids).toHaveLength(48);
  });
  it('stops bounded personal source reads when retained Rows fill before source exhaustion', async () => {
    const { user } = await seed(600);
    const popular = vi.spyOn(
      testApp.app.get(PersonalHomeRepository),
      'findPopularTasteCandidates',
    );
    try {
      const feed = await refresh(user.id);
      const discovery = feed.rows.filter((row) => row.layout === 'standard');
      expect(discovery.length).toBeGreaterThanOrEqual(2);
      expect(
        discovery.every(
          (row) => row.layout === 'standard' && row.items.length === 48,
        ),
      ).toBe(true);
      expect(popular.mock.calls.length).toBeGreaterThan(0);
      expect(
        popular.mock.calls.every(
          ([limit, offset = 0]) => limit === 60 && offset < 540,
        ),
      ).toBe(true);
      expect(new Set(popular.mock.calls.map(([, offset]) => offset)).size).toBe(
        popular.mock.calls.length,
      );
    } finally {
      popular.mockRestore();
    }
  });
  it('finds challenge candidates beyond a full1152-item fit pool without weakening voice semantics', async () => {
    const { records, user } = await seed(1260, true);
    await setVoiceRanges(records, 1200);
    const reference = records[0];
    if (!reference) throw new Error('Missing reference');
    await testApp.db
      .insert(practiceAttempts)
      .values(attemptValue(user.id, reference.id, 0.95, new Date()));
    const feed = await refresh(user.id);
    const challenge = feed.rows.find(({ id }) => id === 'challenge-your-range');
    if (challenge?.layout !== 'vocal-range')
      throw new Error('Later challenge source was lost');
    expect(challenge.items).toHaveLength(48);
    const allowed = new Set(records.slice(1200).map(({ id }) => id));
    expect(
      challenge.items.every(
        (item) =>
          allowed.has(item.id) &&
          item.vocalRange.lowest === 59 &&
          item.vocalRange.highest === 69,
      ),
    ).toBe(true);
  });
  it('protects ordinary initial contents before expanding resume history', async () => {
    const { records, user } = await seed();
    const history = records.slice(0, 60);
    await seedCoordinatedHistory(user.id, history, 30);
    const feed = await refresh(user.id);
    const mostSung = feed.rows.find(({ id }) => id === 'most-sung');
    const resume = feed.rows.find(({ id }) => id === 'continue-singing');
    const singAgain = feed.rows.find(({ id }) => id === 'sing-again');
    if (
      mostSung?.layout !== 'standard' ||
      resume?.layout !== 'standard' ||
      singAgain?.layout !== 'standard'
    )
      throw new Error('A useful initial Row was starved by resume expansion');
    expect(mostSung.items.length).toBeGreaterThanOrEqual(3);
    expect(resume.items.slice(0, 12).map(({ id }) => id)).toEqual(
      history.slice(0, 12).map(({ id }) => id),
    );
    const resumeIds = new Set(resume.items.map(({ id }) => id));
    expect(mostSung.items.some(({ id }) => resumeIds.has(id))).toBe(false);
    const unfinished = new Set(history.slice(0, 30).map(({ id }) => id));
    expect(resume.items.every(({ id }) => unfinished.has(id))).toBe(true);
    const expectedHistory = history
      .filter(({ id }) => resumeIds.has(id))
      .map(({ id }) => id);
    expect(resume.items.map(({ id }) => id)).toEqual(expectedHistory);
    expect(singAgain.items).toHaveLength(30);
    const mastered = new Set(history.slice(30).map(({ id }) => id));
    const discoveryIds = feed.rows
      .filter(({ id, layout }) => layout !== 'ranked' && id !== 'sing-again')
      .flatMap((row) =>
        row.layout === 'hero'
          ? [row.track.id]
          : row.layout === 'standard' || row.layout === 'vocal-range'
            ? row.items.map(({ id }) => id)
            : [],
      );
    expect(discoveryIds.some((id) => mastered.has(id))).toBe(false);
  });
  it('continues past the first48 history candidates after other initial claims', async () => {
    const { records, user } = await seed(300);
    const history = records.slice(0, 100);
    await seedCoordinatedHistory(user.id, history);
    const feed = await refresh(user.id);
    const resume = feed.rows.find(({ id }) => id === 'continue-singing');
    const mostSung = feed.rows.find(({ id }) => id === 'most-sung');
    if (resume?.layout !== 'standard' || mostSung?.layout !== 'standard')
      throw new Error('Missing protected Row');
    expect(resume.items).toHaveLength(48);
    expect(mostSung.items.length).toBeGreaterThanOrEqual(3);
    const singingIds = new Set(mostSung.items.map(({ id }) => id));
    expect(resume.items.some(({ id }) => singingIds.has(id))).toBe(false);
    const resumedIds = new Set(resume.items.map(({ id }) => id));
    expect(resume.items.map(({ id }) => id)).toEqual(
      history.filter(({ id }) => resumedIds.has(id)).map(({ id }) => id),
    );
    expect(
      resume.items.some(({ id }) =>
        history.slice(48).some((track) => track.id === id),
      ),
    ).toBe(true);
  });
  it('refills inherited voice Rows from their full public source for a favourite-only User without range evidence', async () => {
    const { records, user } = await seed(180, true);
    await testApp.db
      .update(tracks)
      .set({ vocalRangeLowest: 60, vocalRangeHighest: 68 });
    const { feed: publicFeed } = await testApp.app
      .get(HomeFeedService)
      .currentPublic('en');
    const publicVoice = publicFeed.rows.find(
      (row) => row.layout === 'vocal-range',
    );
    if (
      publicVoice?.layout !== 'vocal-range' ||
      publicVoice.items.length !== 48
    )
      throw new Error('Missing public voice fixture');
    const claimed = publicVoice.items[12];
    if (!claimed) throw new Error('Missing voice expansion candidate');
    await testApp.db
      .update(tracks)
      .set({ trendingScore: 5000 })
      .where(inArray(tracks.id, [claimed.id]));
    await testApp.db
      .insert(trackFavorites)
      .values({ userId: user.id, trackId: claimed.id });
    const feed = await refresh(user.id);
    expect(feed.rows.some(({ id }) => id === 'within-your-voice')).toBe(false);
    const inherited = feed.rows.find(({ id }) => id === publicVoice.id);
    if (inherited?.layout !== 'vocal-range')
      throw new Error('Inherited voice Row was lost');
    expect(inherited.items).toHaveLength(48);
    expect(inherited.items.some(({ id }) => id === claimed.id)).toBe(false);
    const publicIds = new Set(publicVoice.items.map(({ id }) => id));
    expect(inherited.items.some(({ id }) => !publicIds.has(id))).toBe(true);
    const eligible = new Set(records.map(({ id }) => id));
    expect(
      inherited.items.every(
        (track) =>
          eligible.has(track.id) &&
          track.vocalRange.lowest === 60 &&
          track.vocalRange.highest === 68,
      ),
    ).toBe(true);
  });
});
