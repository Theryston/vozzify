import { cacheTags, homeFeedSchema } from '@vozzify/contracts';
import { eq } from 'drizzle-orm';
import { subscriptions } from '../src/database/schema/subscriptions.js';
import { users } from '../src/database/schema/users.js';
import { StripeBillingService } from '../src/integrations/stripe/stripe-billing.service.js';
import { WEB_REVALIDATION_QUEUE } from '../src/integrations/web-revalidation/web-revalidation.job.js';
import { HomeSocialStore } from '../src/modules/home/home-social.store.js';
import { createAuthClient, signIn } from './utils/auth.js';
import {
  billingCatalog,
  billingProvider,
  billingUser,
  checkoutBody,
  paidProvider,
  signedEvent,
  WEBHOOK_SECRET,
} from './utils/billing-fixture.js';
import { createTestApp, type TestApp } from './utils/create-test-app.js';
import { resetDatabase } from './utils/database.js';
import {
  createPasswordUser,
  createUser,
  createUserFollow,
  DEFAULT_PASSWORD,
} from './utils/factories.js';
import {
  sharedInMemoryCache,
  withInMemoryCache,
} from './utils/in-memory-cache.js';
import {
  createCompletedTrack,
  createTrackContributor,
} from './utils/track-processing-factories.js';

describe('public User Avatar identity', () => {
  let app: TestApp;
  const stripe = billingProvider();

  beforeAll(async () => {
    app = await createTestApp({
      env: { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET },
      override: (builder) =>
        withInMemoryCache(builder)
          .overrideProvider(StripeBillingService)
          .useValue(stripe.provider),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    sharedInMemoryCache.clear();
    await resetDatabase(app.db);
  });

  async function subscribe(userId: string, currentPeriodEnd: Date) {
    await app.db.insert(subscriptions).values({
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
      currentPeriodEnd,
    });
  }

  it('returns only effective public marks for the displayed User', async () => {
    const viewer = await createPasswordUser(app.db, { username: 'viewer' });
    const free = await createUser(app.db, { username: 'free' });
    const admin = await createUser(app.db, {
      username: 'admin',
      role: 'ADMIN',
    });
    const pro = await createUser(app.db, { username: 'pro' });
    const both = await createUser(app.db, { username: 'both', role: 'ADMIN' });
    await billingCatalog(app);
    for (const user of [viewer, pro, both]) {
      await subscribe(user.id, new Date(Date.now() + 60_000));
    }
    await subscribe(admin.id, new Date(Date.now() - 1));
    for (const user of [free, admin, pro, both]) {
      await createUserFollow(app.db, user.id, viewer.id);
    }

    const profile = await app.http.get('/v1/users/both').expect(200);
    expect(profile.body.avatarIdentity).toEqual({ pro: true, admin: true });
    expect(profile.body).not.toHaveProperty('email');
    expect(profile.body).not.toHaveProperty('role');
    expect(profile.body).not.toHaveProperty('subscription');

    const client = createAuthClient(app);
    await signIn(client, {
      email: viewer.email,
      password: DEFAULT_PASSWORD,
    }).expect(200);
    const followers = await client
      .get('/v1/users/viewer/followers')
      .expect(200);
    expect(followers.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: 'admin',
          avatarIdentity: { admin: true },
        }),
        expect.objectContaining({
          username: 'pro',
          avatarIdentity: { pro: true },
        }),
        expect.objectContaining({
          username: 'both',
          avatarIdentity: { pro: true, admin: true },
        }),
        { id: free.id, username: 'free', name: free.name, image: free.image },
      ]),
    );
  });

  it('refreshes Profile marks when membership expires and Admin is assigned', async () => {
    const user = await createUser(app.db, { username: 'keeps_singing' });
    const path = '/v1/users/keeps_singing';
    await billingCatalog(app);
    const endsAt = Date.now() + 60_000;
    await subscribe(user.id, new Date(endsAt));

    const active = await app.http.get(path).expect(200);
    expect(active.body.avatarIdentity).toEqual({ pro: true });

    const clock = vi.spyOn(Date, 'now').mockReturnValue(endsAt);
    try {
      const expired = await app.http.get(path).expect(200);
      expect(expired.body).not.toHaveProperty('avatarIdentity');
    } finally {
      clock.mockRestore();
    }

    await app.db
      .update(users)
      .set({ role: 'ADMIN' })
      .where(eq(users.id, user.id));
    const promoted = await app.http.get(path).expect(200);
    expect(promoted.body.avatarIdentity).toEqual({ pro: true, admin: true });
  });

  it('shows the same identity in Track credits and the full Contributor list', async () => {
    const track = await createCompletedTrack(app.db);
    const user = await createUser(app.db, {
      username: 'studio',
      role: 'ADMIN',
    });
    await billingCatalog(app);
    await subscribe(user.id, new Date(Date.now() + 60_000));
    await createTrackContributor(app.db, track.id, user.id);
    const identity = {
      username: 'studio',
      avatarIdentity: { pro: true, admin: true },
    };
    const list = await app.http
      .get(`/v1/tracks/${track.id}/contributors`)
      .expect(200);
    const detail = await app.http.get(`/v1/tracks/${track.id}`).expect(200);
    const processing = await app.http
      .get(`/v1/tracks/${track.id}/processing`)
      .expect(200);
    for (const entries of [
      list.body.items,
      detail.body.contributors,
      processing.body.contributors,
    ]) {
      expect(entries).toEqual([expect.objectContaining(identity)]);
    }
  });

  it('uses live Avatar identity when serving stored Home People recommendations', async () => {
    const viewer = await createPasswordUser(app.db, { username: 'viewer' });
    const people = await Promise.all(
      ['studio', 'practice', 'harmony', 'rhythm', 'pitch', 'melody'].map(
        (username) => createUser(app.db, { username }),
      ),
    );
    await app.app.get(HomeSocialStore).write(
      viewer.id,
      people.map((person) => ({
        id: person.id,
        name: person.name,
        username: person.username ?? '',
        image: person.image,
        practiceCommonTracks: 4,
        favoriteCommonTracks: 0,
        bothCommonTracks: 0,
        vocalDistance: null,
      })),
    );

    const subject = people.find((person) => person.username === 'studio');
    if (!subject) throw new Error('Missing Home People fixture');
    await billingCatalog(app);
    await subscribe(subject.id, new Date(Date.now() + 60_000));
    const image = 'https://example.com/studio-avatar.webp';
    await app.db
      .update(users)
      .set({ name: 'Studio Singer', image, role: 'ADMIN' })
      .where(eq(users.id, subject.id));

    const client = createAuthClient(app);
    await signIn(client, {
      email: viewer.email,
      password: DEFAULT_PASSWORD,
    }).expect(200);
    const response = await client.get('/v1/home').expect(200);
    const row = homeFeedSchema
      .parse(response.body)
      .rows.find((row) => row.layout === 'people');
    if (row?.layout !== 'people') throw new Error('Missing Home People row');
    expect(row.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: 'studio',
          name: 'Studio Singer',
          image,
          avatarIdentity: { pro: true, admin: true },
        }),
      ]),
    );
  });

  it('publishes Pro and invalidates the User’s Profile after a confirmed checkout', async () => {
    await billingCatalog(app);
    const { user, client } = await billingUser(app);
    if (!user.username) throw new Error('Expected a Username');
    const path = `/v1/users/${user.username}`;
    await client
      .post('/v1/me/subscription/checkout')
      .send(checkoutBody())
      .expect(201);
    expect((await app.http.get(path).expect(200)).body).not.toHaveProperty(
      'avatarIdentity',
    );

    const session = [...stripe.sessions.values()][0];
    if (!session) throw new Error('Expected Stripe checkout');
    const paid = paidProvider(session);
    stripe.contracts.set(paid.id, paid);

    const event = signedEvent(session.customer);
    await app.http
      .post('/v1/billing/stripe-webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', event.signature)
      .send(event.body)
      .expect(200);
    expect((await app.http.get(path).expect(200)).body.avatarIdentity).toEqual({
      pro: true,
    });
    expect(app.queues[WEB_REVALIDATION_QUEUE]?.added).toContainEqual(
      expect.objectContaining({
        data: { tags: [cacheTags.userProfile(user.username)] },
      }),
    );
  });
});
