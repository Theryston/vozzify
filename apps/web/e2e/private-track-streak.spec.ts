import { expect, test } from '@playwright/test';
import { mockAttemptsApi } from './attempts-api-mock';
import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';
import { privatePracticeTrack } from './fake-user-attempts';
import { OWNER_COOKIE } from './fake-user-visibility';
import { messages } from './messages';
import { turnMicOn } from './sing-with-fake-mic';
import { mockStreakApi } from './streak-api-mock';

test.use({ permissions: ['microphone'], timezoneId: 'UTC' });

const OWNER = { ...ADA, username: 'ada_lovelace' };
const PROFILE = `/en/users/${OWNER.username}`;
const FAKE_API = 'http://127.0.0.1:3333';
const caller = `${OWNER_COOKIE}=${OWNER.username}`;
const fixtureApiUrl = (metadata: Record<string, unknown>): string =>
  typeof metadata.fakeApiUrl === 'string' ? metadata.fakeApiUrl : FAKE_API;

test('credits private singing and shows the saved run in owner history', async ({
  page,
  baseURL,
}, testInfo) => {
  const { id, title } = privatePracticeTrack;
  const path = `/en/tracks/${id}`;
  if (!baseURL) throw new Error('Playwright needs a baseURL');
  await page.context().addCookies([
    { ...SIGNED_IN_COOKIE, url: baseURL },
    { name: OWNER_COOKIE, value: OWNER.username, url: baseURL },
  ]);
  await mockAuthApi(page, { user: OWNER });
  const publicAttempts = await mockAttemptsApi(page, {
    preferences: { countIn: false },
  });
  const streak = await mockStreakApi(page, { listenedSeconds: 297 });
  await setPrivateTrackMock(
    {
      ...privatePracticeTrack,
      ownerId: OWNER.id,
      durationMs: 7_000,
      createdAt: '2026-11-20T12:00:00.000Z',
      processing: { status: 'COMPLETED', progress: 100 },
      locked: false,
      notes: [{ pitch: 69, start: 1, end: 6.5 }],
    },
    fixtureApiUrl(testInfo.project.metadata),
  );
  await page.route(`**/v1/me/private-tracks/${id}**`, async (route) => {
    const request = route.request();
    const response = await route.fetch({
      headers: {
        ...request.headers(),
        cookie: `${caller}; ${SIGNED_IN_COOKIE.name}=${SIGNED_IN_COOKIE.value}`,
      },
    });
    await route.fulfill({ response });
  });

  await page.goto(path);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await turnMicOn(page, messages.en.practice.mic);
  await expect(page.getByTestId('detected-note')).toHaveText('A4');
  const attempt = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/private-tracks/${id}/attempts`) &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', {
      name: messages.en.tracks.practice.dock.play,
      exact: true,
    })
    .click();
  await expect(
    page.locator('button[aria-label^="Daily practice:"]'),
  ).toHaveAttribute('data-progress', '1', { timeout: 15_000 });
  expect(streak.heartbeats[0]).toMatchObject({
    privateTrackId: id,
    timeZone: 'UTC',
  });
  expect(streak.heartbeats[0]).not.toHaveProperty('viewId');
  await expect(page.getByTestId('result-accuracy')).toHaveText('100%', {
    timeout: 25_000,
  });
  const saved = await attempt;
  expect(saved.status()).toBe(201);
  expect(saved.request().postDataJSON()).toMatchObject({
    coverage: 1,
    forwardSkip: false,
  });
  expect(publicAttempts.attempts).toHaveLength(0);

  await page.goto(PROFILE);
  const ownerHistory = page.getByRole('region', { name: 'Practice history' });
  await expect(ownerHistory.getByRole('link', { name: title })).toHaveAttribute(
    'href',
    path,
  );
  await expect(
    ownerHistory.getByText(messages.en.profileHistory.privateTrack),
  ).toBeVisible();
});

test('keeps a saved private attempt out of a visitor’s history', async ({
  page,
  request,
}, testInfo) => {
  const { id, title } = privatePracticeTrack;
  const saved = await request.post(
    `${fixtureApiUrl(testInfo.project.metadata)}/v1/me/private-tracks/${id}/attempts`,
    {
      headers: { cookie: caller },
      data: {
        difficulty: 'NORMAL',
        octaveMode: 'ANY',
        transposeSemitones: 0,
        speed: 1,
        accuracy: 1,
        coverage: 1,
        forwardSkip: false,
        bleedSuspected: false,
        startedAt: '2026-11-20T12:00:00.000Z',
        endedAt: '2026-11-20T12:00:07.000Z',
      },
    },
  );
  expect(saved.status()).toBe(201);

  const response = await page.goto(PROFILE);
  const history = page.getByRole('region', { name: 'Practice history' });
  await expect(
    history.getByRole('link', { name: 'Song 1', exact: true }),
  ).toBeVisible();
  await expect(history.getByRole('link', { name: title })).toHaveCount(0);
  expect(response?.ok()).toBe(true);
  expect(await response?.text()).not.toContain(id);
});
