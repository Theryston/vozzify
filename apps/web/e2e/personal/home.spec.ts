import { expect, test } from '@playwright/test';
import type { RecordEventsBody } from '@vozzify/contracts';
import type { FakeHomeRow } from '../fake-home-api';
import {
  circularHero,
  circularTrack,
  installHomeMock,
  restoreHomeMocks,
} from '../home-circular-fixtures';
import { messages } from '../messages';

const baseURL = 'http://localhost:3000';

test.describe.configure({ mode: 'serial' });
test.afterAll(restoreHomeMocks);

const personalRows = (prefix: string): FakeHomeRow[] => [
  circularHero(`${prefix}-hero`, 'Personal genre lead'),
  {
    id: 'daily-target',
    layout: 'daily-target',
    title: { key: 'home.rows.dailyTarget', params: {} },
    secondsLeft: 300,
    targetSeconds: 300,
    streakDays: 0,
    completedToday: false,
  },
  ...[
    'continue-singing',
    'top-10-this-week',
    'because-you-sang',
    'explore',
  ].map((id) => ({
    id,
    layout: id === 'top-10-this-week' ? 'ranked' : 'standard',
    title: { key: 'home.rows.newTracks', params: {} },
    items: [circularTrack(`${prefix}-${id}`, id)],
  })),
  {
    id: `${prefix}-genre`,
    layout: 'standard',
    title: { key: 'home.rows.popularGenre', params: { genre: 'soul' } },
    items: Array.from({ length: 25 }, (_, index) =>
      circularTrack(`${prefix}-${index}`, `Personal soul Track ${index}`),
    ),
  },
];

for (const locale of ['en', 'pt-BR'] as const) {
  test(`renders personal genre continuation and logical attribution in ${locale}`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        errors.push(message.text());
    });
    const events: RecordEventsBody['events'] = [];
    await page.route('**/v1/events', async (route) => {
      const body = route.request().postDataJSON() as RecordEventsBody;
      events.push(...body.events);
      await route.fulfill({ status: 204 });
    });
    await page.setViewportSize(
      locale === 'en'
        ? { width: 1280, height: 800 }
        : { width: 390, height: 844 },
    );
    await page.emulateMedia({
      colorScheme: locale === 'en' ? 'light' : 'dark',
      reducedMotion: 'reduce',
    });
    const prefix = `personal-genre-${locale}-${Date.now()}`;
    const rows = personalRows(prefix);
    const publicRows = [
      circularHero(`${prefix}-public`, 'Public genre lead'),
      { ...rows.at(-1), id: `${prefix}-public-genre` },
    ];
    await installHomeMock({
      feeds: { en: publicRows, 'pt-BR': publicRows },
      personal: { en: rows, 'pt-BR': rows },
    });
    await context.addCookies([
      { name: 'vozzify.session_token', value: 'signed-in', url: baseURL },
    ]);
    await page.goto(`/${locale}`);
    await expect(
      page.locator('[data-home-row-id="daily-target"]'),
    ).toBeVisible();
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const genre = page.locator(`[data-home-row-id="${prefix}-genre"]`);
    await expect(
      genre.getByRole('heading', {
        name: locale === 'en' ? 'Popular in soul' : 'Popular em soul',
      }),
    ).toBeVisible();
    await expect(
      page.locator(`[data-home-row-id="${prefix}-public-genre"]`),
    ).toHaveCount(0);
    const list = genre.locator('ul');
    for (const lastIndex of [23, 24]) {
      await list.evaluate((element) =>
        element.scrollTo({ left: element.scrollWidth }),
      );
      await expect(
        genre.locator(`[data-home-item-id="${prefix}-${lastIndex}"]`).first(),
      ).toBeAttached();
    }
    const logical = genre.locator(
      '[data-home-item-id]:not([aria-hidden="true"])',
    );
    await expect(logical).toHaveCount(25);
    const last = logical.last();
    await expect(last).toHaveAttribute('data-home-item-id', `${prefix}-24`);
    await expect(last).toHaveAttribute('data-home-item-position', '24');
    await expect(last).toContainText('A2');
    await expect(
      genre.getByText(messages[locale].home.sponsored.row),
    ).toHaveCount(0);
    const rowIds = await page
      .locator('[data-home-row-id]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-home-row-id')),
      );
    expect(rowIds).toEqual(rows.map(({ id }) => id));
    await page.evaluate(() => {
      document.addEventListener(
        'click',
        (event) => event.preventDefault(),
        true,
      );
    });
    await last.locator('a').first().click();
    await expect
      .poll(() => events.find((event) => event.type === 'home.item_click'))
      .toMatchObject({
        type: 'home.item_click',
        rowId: `${prefix}-genre`,
        itemId: `${prefix}-24`,
        position: 24,
        audience: 'personal',
        locale,
        clickId: expect.any(String),
        eventId: expect.any(String),
      });
    expect(errors).toEqual([]);
  });
}
