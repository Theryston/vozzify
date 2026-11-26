import { expect, test } from '@playwright/test';
import type { PrivateTrackDetail } from '@vozzify/contracts';
import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';
import { messages } from './messages';

const initial: PrivateTrackDetail = {
  id: 'private_retry',
  ownerId: ADA.id,
  title: 'Rehearsal recording',
  artist: 'Local singer',
  durationMs: 30_000,
  createdAt: '2026-11-24T12:00:00.000Z',
  locked: false,
  processing: { status: 'FAILED', progress: 0 },
  notes: [],
};

test('follows a failed private recording from My tracks through retry and practice', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Expected the web server URL');
  const t = messages.en;
  const headers = {
    'access-control-allow-origin': baseURL,
    'access-control-allow-credentials': 'true',
  };
  let current: PrivateTrackDetail = {
    ...initial,
    processing: { status: 'DETECTING_NOTES', progress: 70 },
  };
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.context().addCookies([{ ...SIGNED_IN_COOKIE, url: baseURL }]);
  await setPrivateTrackMock(initial);
  await page.route(
    (url) => url.pathname === '/v1/me/private-tracks',
    (route) =>
      route.fulfill({
        headers,
        json: { canSubmit: true, items: [current], nextCursor: null },
      }),
  );
  const detailPath = `/v1/me/private-tracks/${initial.id}`;
  await page.route(
    (url) => url.pathname === detailPath,
    (route) => route.fulfill({ headers, json: current }),
  );
  await page.route(
    (url) => url.pathname === `${detailPath}/retry`,
    (route) => {
      expect(route.request().method()).toBe('POST');
      current = { ...current, processing: { status: 'QUEUED', progress: 0 } };
      return route.fulfill({ status: 202, headers, json: current.processing });
    },
  );

  await page.goto('/en/me/tracks');
  const row = page.getByRole('link', { name: new RegExp(initial.title) });
  await expect(row).toContainText(
    t.privateTracks.detail.processing.DETECTING_NOTES,
  );
  current = initial;
  await expect(row).toContainText(t.privateTracks.detail.processing.FAILED, {
    timeout: 10_000,
  });
  await row.click();
  await expect(
    page.getByRole('heading', { name: initial.title }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: t.tracks.processing.failed.title }),
  ).toBeVisible();
  const retry = page.getByRole('button', {
    name: t.tracks.processing.retry.action,
  });
  await retry.click();
  await expect(page.getByRole('status')).toContainText(
    t.tracks.processing.queued.title,
  );
  await expect(retry).toHaveCount(0);
  current = {
    ...current,
    processing: { status: 'COMPLETED', progress: 100 },
    notes: [{ pitch: 69, start: 0.1, end: 0.4 }],
  };
  await expect(
    page.getByRole('img', { name: /1 note, from A4 to A4/ }),
  ).toBeVisible({
    timeout: 10_000,
  });
  await expect(page).toHaveURL(`/en/tracks/${initial.id}`);
  const progress = page.getByRole('slider', {
    name: t.tracks.practice.dock.progress,
  });
  await page.getByRole('button', { name: t.tracks.practice.dock.play }).click();
  await expect
    .poll(async () => Number(await progress.getAttribute('aria-valuenow')))
    .toBeGreaterThan(0);
});

test('shows the failure on a locked private track without a retry control', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Expected the web server URL');
  const t = messages['pt-BR'];
  const locked = { ...initial, id: 'private_retry_locked', locked: true };
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.context().addCookies([{ ...SIGNED_IN_COOKIE, url: baseURL }]);
  await setPrivateTrackMock(locked);
  await page.goto(`/pt-BR/tracks/${locked.id}`);
  await expect(
    page.getByText(t.privateTracks.detail.processing.FAILED),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: t.privateTracks.detail.reactivate }),
  ).toHaveAttribute('href', '/pt-BR/plans');
  await expect(
    page.getByRole('button', { name: t.tracks.processing.retry.action }),
  ).toHaveCount(0);
});
