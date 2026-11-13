import { type BrowserContext, expect, type Page } from '@playwright/test';
import { allowedAdConsent } from '../features/advertising/consent-fixture';
import {
  defaultHomeRows,
  type FakeHomeRow,
  setHomeMock,
} from './fake-home-api';
import { webServerEnv } from './web-server-env';

export const baseURL = 'http://localhost:3000';
const apiURL = 'http://127.0.0.1:3333';
export const cmpURL = `${apiURL}/__adsense-cmp.js`;
export const adScriptURL =
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-0000000000000000';
export const adSlotURL = 'https://adsense-provider.test/slot';

export const consent = { ...allowedAdConsent };

export function paidSubscription({
  planName = 'Free',
  providerStatus = 'active',
  cancelAtPeriodEnd = false,
}: {
  planName?: string;
  providerStatus?: string;
  cancelAtPeriodEnd?: boolean;
} = {}) {
  return {
    subscription: {
      planId: 'paid-plan',
      planName,
      cycle: 'monthly',
      currency: 'BRL',
      amount: 1000,
      status: 'confirmed',
      providerStatus,
      paidMembership: true,
      currentPeriodStart: '2026-11-01T00:00:00.000Z',
      currentPeriodEnd: '2026-12-01T00:00:00.000Z',
      cancelAtPeriodEnd,
    },
  };
}

export async function expectPaidMembershipWithheld(
  page: Page,
  context: BrowserContext,
  subscription: unknown,
) {
  await setSession(page, true);
  await setSubscription(page, subscription);
  await setCmp(page, consent);
  await setAdProvider(page);
  await context.addCookies([
    { name: 'vozzify.session_token', value: 'signed-in', url: baseURL },
  ]);
  const adRequests = observeAdRequests(page);
  const sessionResponse = page.waitForResponse('**/v1/auth/get-session');
  const subscriptionResponse = page.waitForResponse('**/v1/me/subscription**');
  await page.goto('/en');
  await Promise.all([sessionResponse, subscriptionResponse]);
  await expect(
    page.getByRole('link', { name: /Ad test song/ }).first(),
  ).toBeVisible();
  await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(0);
  expect(adRequests).toHaveLength(0);
}

export function feedRows(count: number): FakeHomeRow[] {
  const base = defaultHomeRows('en');
  const lead = base[0];
  if (!lead) throw new Error('Expected a default Home hero');
  const row: FakeHomeRow = {
    id: 'ads-row-1',
    layout: 'standard',
    title: { key: 'home.rows.newTracks', params: {} },
    items: [
      {
        id: 'ads-track',
        title: 'Ad test song',
        coverUrl: null,
        artistCredit: [{ name: 'Vozzify', joinPhrase: '' }],
        durationMs: 180000,
        vocalRange: { lowest: 45, highest: 64 },
      },
    ],
  };
  return [
    lead,
    ...Array.from({ length: count - 1 }, (_, index) => ({
      ...row,
      id: `ads-row-${index + 1}`,
    })),
  ];
}

export async function installFeed(rows = feedRows(12)) {
  await setHomeFeed(rows);
  await expect
    .poll(async () => (await fetch(`${baseURL}/en`)).text())
    .toContain('/en/tracks/');
}

export async function setHomeFeed(rows: FakeHomeRow[]) {
  await setHomeMock({ feeds: { en: rows } });
  const response = await fetch(`${baseURL}/api/revalidate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tags: ['home:en'] }),
  });
  expect(response.ok).toBe(true);
}

export function observeAdRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().startsWith(adScriptURL) ||
      request.url().startsWith(adSlotURL)
    )
      requests.push(request.url());
  });
  return requests;
}

export function observeSlotRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(adSlotURL)) requests.push(request.url());
  });
  return requests;
}

export function observeCmpRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url() === cmpURL) requests.push(request.url());
  });
  return requests;
}

export async function setSession(page: Page, user: boolean | 'failure') {
  await page.route('**/v1/auth/get-session', (route) => {
    if (user === 'failure') {
      return route.fulfill({ status: 503, body: '{}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        user
          ? {
              session: { id: 'session-ads' },
              user: {
                id: 'user-ads',
                name: 'Ada',
                email: 'ada@example.com',
                emailVerified: true,
                username: 'ada_singer',
              },
            }
          : null,
      ),
    });
  });
}

export async function setSubscription(
  page: Page,
  value: unknown,
  status = 200,
) {
  await page.route('**/v1/me/subscription**', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(value),
    }),
  );
}

export async function setCmp(page: Page, value: Record<string, unknown>) {
  await page.route(cmpURL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body:
        'window.__tcfapi=function(command,version,callback){' +
        "if(command==='addEventListener'){callback(" +
        `${JSON.stringify({ ...value, listenerId: 1 })}` +
        ",true)}if(command==='removeEventListener'){callback(true,true)}}",
    }),
  );
}

export async function setAdProvider(
  page: Page,
  outcomes: Array<'filled' | 'unfilled'> = ['filled'],
  status = 200,
) {
  await page.route(`${adSlotURL}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: '' }),
  );
  await page.route(adScriptURL, (route) =>
    route.fulfill({
      status,
      contentType: 'text/javascript',
      body:
        `const outcomes=${JSON.stringify(outcomes)};let requestNumber=0;` +
        'window.adsbygoogle.push=function(){' +
        'const slot=document.querySelector("ins.adsbygoogle:not([data-ad-status])");' +
        'if(slot){const npa=window.adsbygoogle.requestNonPersonalizedAds||0;' +
        'const request=new Image();request.src="https://adsense-provider.test/slot?npa="+npa+"&request="+requestNumber++;' +
        'const outcome=outcomes.shift()||"filled";' +
        'if(outcome==="filled")slot.style.height="180px";' +
        'slot.dataset.adStatus=outcome;}}',
    }),
  );
}
