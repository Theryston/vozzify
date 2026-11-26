import { eq } from 'drizzle-orm';
import { dailyPracticeStreaks } from '../src/database/schema/daily-practice-streaks.js';
import { privateTracks } from '../src/database/schema/private-tracks.js';
import { subscriptions } from '../src/database/schema/subscriptions.js';
import { createAuthClient, signIn } from './utils/auth.js';
import { useAuthSpec } from './utils/auth-spec.js';
import { billingCatalog } from './utils/billing-fixture.js';
import {
  createPasswordUser,
  createTrack,
  DEFAULT_PASSWORD,
} from './utils/factories.js';

const ROOT = '/v1/me/private-tracks';
const HEARTBEAT = '/v1/me/streak/heartbeat';
const SUMMARY = '/v1/users/rehearsal_owner/summary';
const HISTORY = '/v1/users/rehearsal_owner/attempts?includePrivate=true';

const run = {
  difficulty: 'NORMAL',
  octaveMode: 'ANY',
  transposeSemitones: 0,
  speed: 1,
  accuracy: 0.9,
  coverage: 0.95,
  forwardSkip: false,
  bleedSuspected: false,
  startedAt: '2026-10-16T10:00:00.000Z',
  endedAt: '2026-10-16T10:04:00.000Z',
};

describe('Private practice (e2e)', () => {
  const spec = useAuthSpec();
  let ownerId: string;
  let other: ReturnType<typeof createAuthClient>;
  let privateTrackId: string;

  beforeEach(async () => {
    const { db } = spec.testApp;
    const owner = await createPasswordUser(db, { username: 'rehearsal_owner' });
    const visitor = await createPasswordUser(db);
    ownerId = owner.id;
    await billingCatalog(spec.testApp);
    await db.insert(subscriptions).values(
      [owner.id, visitor.id].map(
        (userId): typeof subscriptions.$inferInsert => ({
          userId,
          planId: 'pro',
          priceId: 'usd-monthly',
          cycle: 'monthly',
          currency: 'USD',
          amount: 350,
          stripePriceId: 'price_usd_monthly',
          status: 'confirmed',
          providerStatus: 'active',
          paidMembership: true,
          hasPaidInvoice: true,
          currentPeriodStart: new Date(Date.now() - 60_000),
          currentPeriodEnd: new Date(Date.now() + 86_400_000),
        }),
      ),
    );
    const [track] = await db
      .insert(privateTracks)
      .values({
        userId: ownerId,
        contentSha256: 'practice-fixture-hash',
        objectKey: `${ownerId}/practice-fixture`,
        originalFilename: 'rehearsal.wav',
        title: 'Private rehearsal take',
        artist: 'Private artist',
        durationMs: 240_000,
        processingStatus: 'COMPLETED',
      })
      .returning({ id: privateTracks.id });
    if (!track) throw new Error('Expected a private track');
    privateTrackId = track.id;
    other = createAuthClient(spec.testApp);
    await Promise.all([
      signIn(spec.client, {
        email: owner.email,
        password: DEFAULT_PASSWORD,
      }).expect(200),
      signIn(other, {
        email: visitor.email,
        password: DEFAULT_PASSWORD,
      }).expect(200),
    ]);
  });

  it('credits private singing to the same practice clock and completes the Practice day', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await spec.testApp.db.insert(dailyPracticeStreaks).values({
      userId: ownerId,
      day: today,
      listenedSeconds: 298,
      completed: false,
    });

    const response = await spec.client
      .post(HEARTBEAT)
      .send({ privateTrackId, elapsedSeconds: 5, timeZone: 'UTC' })
      .expect(200);

    expect(response.body).toMatchObject({
      creditedSeconds: 5,
      justCompleted: true,
      status: { day: today, listenedSeconds: 300, currentStreakDays: 1 },
    });
    expect(
      (await spec.testApp.http.get(SUMMARY).expect(200)).body,
    ).toMatchObject({
      streakDays: 1,
    });
  });

  it('credits a private practice attempt without exposing it alongside a public Track for the same Recording', async () => {
    const publicTrack = await createTrack(spec.testApp.db, {
      title: 'Catalog recording',
    });
    const coverUrl = 'https://coverartarchive.org/release/rehearsal/front-250';
    const privateAttempt = (
      await spec.client
        .post(`${ROOT}/${privateTrackId}/attempts`)
        .send(run)
        .expect(201)
    ).body;
    expect(privateAttempt).toMatchObject({
      trackId: privateTrackId,
      isPrivate: true,
    });
    await spec.client
      .post(`${ROOT}/${privateTrackId}/attempts`)
      .send({ ...run, bleedSuspected: true })
      .expect(201);
    await spec.client
      .post(`/v1/tracks/${publicTrack.id}/attempts`)
      .send(run)
      .expect(201);
    await spec.testApp.db
      .update(privateTracks)
      .set({
        titleOverride: 'My corrected rehearsal title',
        recordingLink: {
          kind: 'linked',
          recording: {
            mbid: publicTrack.recordingMbid,
            title: publicTrack.title,
            artist: 'Catalog artist',
            coverUrl,
          },
        },
      })
      .where(eq(privateTracks.id, privateTrackId));

    const summary = await spec.testApp.http.get(SUMMARY).expect(200);
    expect(summary.body).toMatchObject({ sungCount: 2 });
    const ownerPage = await spec.client.get(`${HISTORY}&limit=1`).expect(200);
    expect(ownerPage.headers['cache-control']).toBe('private, no-store');
    const remaining = await spec.client
      .get(`${HISTORY}&limit=2&cursor=${ownerPage.body.nextCursor}`)
      .expect(200);
    const ownerRuns = [...ownerPage.body.items, ...remaining.body.items];
    expect(ownerRuns).toHaveLength(3);
    expect(ownerRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: privateAttempt.id,
          track: {
            id: privateTrackId,
            title: 'My corrected rehearsal title',
            artistCredit: [{ name: 'Catalog artist', joinPhrase: '' }],
            coverUrl,
          },
        }),
        expect.objectContaining({ trackId: publicTrack.id }),
      ]),
    );
    expect(
      (await spec.client.get('/v1/me/attempts').expect(200)).body.items,
    ).toContainEqual(
      expect.objectContaining({
        id: privateAttempt.id,
        trackId: privateTrackId,
      }),
    );

    for (const client of [other, spec.testApp.http]) {
      const response = await client.get(HISTORY).expect(200);
      expect(response.body.items).toEqual([
        expect.objectContaining({ trackId: publicTrack.id }),
      ]);
      expect(JSON.stringify(response.body)).not.toContain(privateTrackId);
      expect(JSON.stringify(response.body)).not.toContain(privateAttempt.id);
      expect(JSON.stringify(response.body)).not.toContain(
        'My corrected rehearsal title',
      );
      expect(JSON.stringify(response.body)).not.toContain(coverUrl);
    }

    await spec.client.delete(`${ROOT}/${privateTrackId}`).expect(204);
    expect((await spec.client.get(HISTORY).expect(200)).body.items).toEqual([
      expect.objectContaining({ trackId: publicTrack.id }),
    ]);
    expect(
      (await spec.testApp.http.get(SUMMARY).expect(200)).body,
    ).toMatchObject({ sungCount: 2 });
  });

  it('denies private practice to other Users and expired owners and enforces attempt eligibility', async () => {
    const attempts = `${ROOT}/${privateTrackId}/attempts`;
    const heartbeat = { privateTrackId, elapsedSeconds: 5, timeZone: 'UTC' };
    await spec.testApp.http.post(attempts).send(run).expect(401);
    await other.post(attempts).send(run).expect(404);
    await other.post(HEARTBEAT).send(heartbeat).expect(404);
    await spec.client
      .post(attempts)
      .send({ ...run, coverage: 0.89 })
      .expect(422);
    await spec.client
      .post(attempts)
      .send({ ...run, forwardSkip: true })
      .expect(422);

    await spec.testApp.db
      .update(subscriptions)
      .set({ currentPeriodEnd: new Date(Date.now() - 1_000) })
      .where(eq(subscriptions.userId, ownerId));
    await spec.client.post(attempts).send(run).expect(403);
    await spec.client.post(HEARTBEAT).send(heartbeat).expect(403);
    expect(
      (await spec.client.get('/v1/me/streak?timeZone=UTC').expect(200)).body,
    ).toMatchObject({ listenedSeconds: 0 });
  });

  it('keeps history available for source tags longer than the shared history header allows', async () => {
    const title = 'Rehearsal '.repeat(60);
    const artist = 'Studio '.repeat(40);
    await spec.testApp.db
      .update(privateTracks)
      .set({ title, artist })
      .where(eq(privateTracks.id, privateTrackId));
    await spec.client
      .post(`${ROOT}/${privateTrackId}/attempts`)
      .send(run)
      .expect(201);

    const history = await spec.client.get(HISTORY).expect(200);
    expect(history.body.items[0].track).toMatchObject({
      title: title.slice(0, 500),
      artistCredit: [{ name: artist.slice(0, 200), joinPhrase: '' }],
    });
  });
});
