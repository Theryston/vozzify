import { expect, test } from '@playwright/test';
import { defaultHomeRows, setHomeMock } from './fake-home-api';
import {
  adScriptURL,
  baseURL,
  cmpURL,
  consent,
  expectPaidMembershipWithheld,
  feedRows,
  installFeed,
  observeAdRequests,
  observeSlotRequests,
  paidSubscription,
  setAdProvider,
  setCmp,
  setSession,
  setSubscription,
} from './home-ads-fixtures';
import { messages } from './messages';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  await installFeed();
});

test.afterAll(async () => {
  await setHomeMock({
    feeds: { en: defaultHomeRows('en'), 'pt-BR': defaultHomeRows('pt-BR') },
  });
});

test.describe('Home native In-feed advertising', () => {
  test('does not request inventory when fewer than three Rows render', async ({
    page,
  }) => {
    await installFeed(feedRows(2));
    await setSession(page, false);
    await setCmp(page, consent);
    await setAdProvider(page);
    const slotRequests = observeSlotRequests(page);
    const cmpResponse = page.waitForResponse(cmpURL);
    const providerResponse = page.waitForResponse((response) =>
      response.url().startsWith(adScriptURL),
    );
    await page.goto('/en');
    expect((await cmpResponse).status()).toBe(200);
    expect((await providerResponse).status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-home-row-id]')).toHaveCount(2);
    await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(0);
    expect(slotRequests).toHaveLength(0);
  });

  test('renders a filled unit after Rows 3 and 6 without changing content order', async ({
    page,
  }) => {
    await setSession(page, false);
    await setCmp(page, consent);
    await setAdProvider(page, ['filled', 'filled']);
    const adScriptRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(adScriptURL)) {
        adScriptRequests.push(request.url());
      }
    });
    await page.goto('/en');

    await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(2);
    const order = await page
      .locator('[data-home-row-id], [data-testid="home-in-feed-ad"]')
      .evaluateAll((elements) =>
        elements.map(
          (element) =>
            (element as HTMLElement).dataset.homeRowId ?? 'advertisement',
        ),
      );
    expect(order).toEqual([
      'hero',
      'ads-row-1',
      'ads-row-2',
      'advertisement',
      'ads-row-3',
      'ads-row-4',
      'ads-row-5',
      'advertisement',
    ]);
    await expect(
      page.getByRole('complementary', { name: 'Advertisement' }),
    ).toHaveCount(2);
    await expect(page.getByTestId('adsense-slot').first()).toHaveAttribute(
      'data-ad-format',
      'fluid',
    );
    expect(adScriptRequests).toHaveLength(1);
  });

  test('keeps later Row boundaries after no-fill across vertical pages', async ({
    page,
  }) => {
    await setSession(page, false);
    await setCmp(page, consent);
    await setAdProvider(page, ['unfilled', 'unfilled', 'filled', 'filled']);
    const slotRequests = observeSlotRequests(page);
    await page.goto('/en');

    await expect(page.locator('[data-home-row-id]')).toHaveCount(6);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('[data-home-row-id]')).toHaveCount(12);
    await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(2);
    await expect.poll(() => slotRequests.length).toBe(4);
    await expect(
      page.getByRole('link', { name: /Ad test song/ }).first(),
    ).toBeVisible();
  });

  test('uses unique visible Rows across pages and ignores horizontal item pages', async ({
    page,
  }) => {
    const rows = feedRows(10);
    const firstCarousel = rows[1];
    const repeated = rows[6];
    if (!firstCarousel || !repeated || !Array.isArray(firstCarousel.items)) {
      throw new Error('Expected the Home fixture to contain carousels');
    }
    const longItems = Array.from({ length: 48 }, (_, index) => ({
      id: `horizontal-${index}`,
      title: `Horizontal song ${index}`,
      coverUrl: null,
      artistCredit: [{ name: 'Vozzify', joinPhrase: '' }],
      durationMs: 180000,
      vocalRange: { lowest: 45, highest: 64 },
    }));
    rows[1] = { ...firstCarousel, items: longItems };
    rows[6] = { ...repeated, id: firstCarousel.id };
    await installFeed(rows);
    await setSession(page, false);
    await setCmp(page, consent);
    await setAdProvider(page, ['filled', 'filled', 'filled']);
    const slotRequests = observeSlotRequests(page);
    const releases: (() => void)[] = [];
    await page.route(/\/v1\/home\/rows\/[^/]+\/items\?/, async (route) => {
      const response = await route.fetch();
      await new Promise<void>((resolve) => releases.push(resolve));
      await route.fulfill({ response });
    });
    await page.goto('/en');
    await expect(page.locator('[data-home-row-id]')).toHaveCount(6);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('[data-home-row-id]')).toHaveCount(9);
    await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(3);

    const trackList = page.locator('[data-home-row-id="ads-row-1"] ul');
    const items = trackList.locator(
      '[data-home-item-id]:not([aria-hidden="true"])',
    );
    await trackList.scrollIntoViewIfNeeded();
    await expect(items).toHaveCount(12);
    for (const expected of [24, 36, 48]) {
      await trackList.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
        element.dispatchEvent(new Event('scroll'));
      });
      await expect.poll(() => releases.length).toBeGreaterThan(0);
      const release = releases.shift();
      if (!release) throw new Error('Expected a horizontal page response');
      release();
      await expect(items).toHaveCount(expected);
    }
    await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(3);
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.querySelectorAll('ins.adsbygoogle[data-ad-status]').length,
        ),
      )
      .toBe(3);
    expect(slotRequests).toHaveLength(3);
  });

  test('allows confirmed free members and withholds active paid access', async ({
    page,
    context,
  }) => {
    await setSession(page, true);
    await setSubscription(page, { subscription: null });
    await setCmp(page, consent);
    await setAdProvider(page);
    await context.addCookies([
      {
        name: 'vozzify.session_token',
        value: 'signed-in',
        url: baseURL,
      },
    ]);
    await page.goto('/en');
    await expect(page.getByTestId('home-in-feed-ad').first()).toBeVisible();
  });

  test('keeps trial subscriptions with paid access ad-free', async ({
    page,
    context,
  }) => {
    await expectPaidMembershipWithheld(
      page,
      context,
      paidSubscription({ providerStatus: 'trialing' }),
    );
  });

  test('keeps active paid memberships ad-free', async ({ page, context }) => {
    await expectPaidMembershipWithheld(page, context, paidSubscription());
  });

  test('keeps remaining paid access after cancellation ad-free', async ({
    page,
    context,
  }) => {
    await expectPaidMembershipWithheld(
      page,
      context,
      paidSubscription({ planName: 'Paid', cancelAtPeriodEnd: true }),
    );
  });

  test('withholds ads for unresolved sessions and failed Subscription lookups', async ({
    page,
    context,
  }) => {
    await setSession(page, 'failure');
    await setCmp(page, consent);
    await setAdProvider(page);
    const adRequests = observeAdRequests(page);
    const failedSessionResponse = page.waitForResponse(
      '**/v1/auth/get-session',
    );
    await page.goto('/en');
    expect((await failedSessionResponse).status()).toBe(503);
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('link', { name: /Ad test song/ }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(0);
    expect(adRequests).toHaveLength(0);

    await setSession(page, true);
    await setSubscription(page, {}, 503);
    await context.addCookies([
      { name: 'vozzify.session_token', value: 'signed-in', url: baseURL },
    ]);
    const sessionResponse = page.waitForResponse('**/v1/auth/get-session');
    const subscriptionResponse = page.waitForResponse(
      '**/v1/me/subscription**',
    );
    await page.goto('/en');
    expect((await sessionResponse).status()).toBe(200);
    expect((await subscriptionResponse).status()).toBe(503);
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('link', { name: /Ad test song/ }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(0);
    expect(adRequests).toHaveLength(0);
  });

  test('waits for session and Subscription responses before requesting ads', async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: 'vozzify.session_token', value: 'signed-in', url: baseURL },
    ]);
    let releaseSession: (() => void) | undefined;
    await page.route('**/v1/auth/get-session', async (route) => {
      await new Promise<void>((resolve) => {
        releaseSession = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { id: 'session-ads' },
          user: {
            id: 'user-ads',
            name: 'Ada',
            email: 'ada@example.com',
            emailVerified: true,
            username: 'ada_singer',
          },
        }),
      });
    });
    let releaseSubscription: (() => void) | undefined;
    await page.route('**/v1/me/subscription**', async (route) => {
      await new Promise<void>((resolve) => {
        releaseSubscription = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscription: null }),
      });
    });
    const cmpRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url() === cmpURL) cmpRequests.push(request.url());
    });
    await page.goto('/en');
    await expect(
      page.getByRole('link', { name: /Ad test song/ }).first(),
    ).toBeVisible();
    expect(cmpRequests).toHaveLength(0);
    await expect.poll(() => releaseSession !== undefined).toBe(true);
    if (!releaseSession) throw new Error('Expected a pending session request');
    releaseSession();
    await expect.poll(() => releaseSubscription !== undefined).toBe(true);
    expect(cmpRequests).toHaveLength(0);
    if (!releaseSubscription)
      throw new Error('Expected a pending Subscription request');
    const cmpRequest = page.waitForRequest(cmpURL);
    releaseSubscription();
    await cmpRequest;
    expect(cmpRequests).toHaveLength(1);
  });

  test('does not request an ad when the provider script fails', async ({
    page,
  }) => {
    await setSession(page, false);
    await setCmp(page, consent);
    await page.route(adScriptURL, (route) => route.abort('blockedbyclient'));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/en');
    await expect(
      page.getByRole('link', { name: /Ad test song/ }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('does not create a slot when the provider returns HTTP failure', async ({
    page,
  }) => {
    await setSession(page, false);
    await setCmp(page, consent);
    await setAdProvider(page, ['filled'], 503);
    const adRequests = observeSlotRequests(page);
    const providerResponse = page.waitForResponse((response) =>
      response.url().startsWith(adScriptURL),
    );
    await page.goto('/en');
    expect((await providerResponse).status()).toBe(503);
    await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(0);
    expect(adRequests).toHaveLength(0);
  });

  test('keeps consent unresolved without requesting provider inventory', async ({
    page,
  }) => {
    await setSession(page, false);
    await setCmp(page, { ...consent, eventStatus: 'cmpuishown' });
    await setAdProvider(page);
    const adRequests = observeAdRequests(page);
    const cmpResponse = page.waitForResponse(cmpURL);
    await page.goto('/en');
    expect((await cmpResponse).status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('link', { name: /Ad test song/ }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(0);
    expect(adRequests).toHaveLength(0);
  });

  test('requires storage consent and serves non-personalized ads when personalization is declined', async ({
    page,
  }) => {
    await setSession(page, false);
    await setCmp(page, {
      ...consent,
      purpose: {
        consents: {
          1: true,
          2: true,
          3: false,
          4: false,
          7: true,
          9: true,
          10: true,
        },
      },
    });
    await setAdProvider(page);
    await page.goto('/en');
    await expect(page.getByTestId('home-in-feed-ad').first()).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .filter((entry) =>
              entry.name.startsWith('https://adsense-provider.test/slot'),
            )
            .map((entry) => new URL(entry.name).searchParams.get('npa')),
        ),
      )
      .toContain('1');

    await page.goto('/pt-BR');
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(
      page.getByRole('complementary', { name: 'Publicidade' }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
  });

  test('serves non-personalized inventory for reduced non-GDPR TCData', async ({
    page,
  }) => {
    await setSession(page, false);
    await setCmp(page, { gdprApplies: false });
    await setAdProvider(page);
    const slotRequests = observeSlotRequests(page);
    const cmpResponse = page.waitForResponse(cmpURL);
    await page.goto('/en');
    expect((await cmpResponse).status()).toBe(200);
    await expect(page.getByTestId('home-in-feed-ad').first()).toBeVisible();
    await expect.poll(() => slotRequests.length).toBe(2);
    expect(
      slotRequests.map((request) => new URL(request).searchParams.get('npa')),
    ).toEqual(['1', '1']);
  });

  test('withholds ads after consent refusal and keeps the feed available', async ({
    page,
  }) => {
    await setSession(page, false);
    await setCmp(page, {
      ...consent,
      purpose: { consents: { 1: false } },
    });
    const adRequests = observeAdRequests(page);
    await page.goto('/en');
    await expect(
      page.getByRole('link', { name: /Ad test song/ }).first(),
    ).toBeVisible();
    expect(adRequests).toHaveLength(0);
    await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(0);
  });

  test('keeps the unit in the feed at a phone viewport and dark theme', async ({
    page,
  }) => {
    await setSession(page, false);
    await setCmp(page, consent);
    await setAdProvider(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/en');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(
      page.getByRole('complementary', { name: 'Advertisement' }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    expect(messages.en.home.rows.newTracks).toBeTruthy();
  });
});
