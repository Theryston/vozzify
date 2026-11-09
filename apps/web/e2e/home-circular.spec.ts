import { expect, test } from '@playwright/test';

import { defaultHomeRows, setHomeMock } from './fake-home-api';
import { messages } from './messages';
import { webServerEnv } from './web-server-env';

const baseURL = 'http://localhost:3000';
const lead = `circular-hero-${Date.now()}`;
const rowId = `circular-row-${Date.now()}`;
const cards = Array.from({ length: 48 }, (_, index) => ({
  id: `circular-track-${index}`,
  title: `Circular song ${index}`,
  coverUrl: null,
  artistCredit: [{ name: 'Vozzify', joinPhrase: '' }],
  durationMs: 180000,
  vocalRange: { lowest: 45, highest: 64 },
}));

async function installCircularFeed(itemCount = 12): Promise<void> {
  await setHomeMock({
    feeds: {
      en: [
        {
          id: 'hero',
          layout: 'hero',
          track: {
            id: lead,
            title: 'Circular hero',
            coverUrl: null,
            artistCredit: [{ name: 'Vozzify', joinPhrase: '' }],
            durationMs: 180000,
            vocalRange: { lowest: 45, highest: 64 },
          },
        },
        {
          id: rowId,
          layout: 'standard',
          title: { key: 'home.rows.trendingToday', params: {} },
          items: cards.slice(0, itemCount),
        },
      ],
    },
  });
  const response = await fetch(`${baseURL}/api/revalidate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tags: ['home:en'] }),
  });
  expect(response.ok).toBe(true);
  await expect
    .poll(async () => (await fetch(`${baseURL}/en`)).text())
    .toContain(`/en/tracks/${lead}`);
}

test.describe('exhausted Home carousels', () => {
  test('wraps geometry both ways with one accessible, attributed item set', async ({
    page,
  }) => {
    await installCircularFeed();
    const eventBodies: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/v1/events')) {
        eventBodies.push(request.postData() ?? '');
      }
    });
    await page.goto('/en');
    const row = page.locator(`[data-home-row-id="${rowId}"]`);
    const track = row.locator('ul');
    const middle = row.locator('[data-carousel-copy="middle"]');
    await expect(middle).toHaveCount(12);
    await expect(row.locator('[data-carousel-copy="before"]')).toHaveCount(12);
    await expect(row.locator('[data-carousel-copy="after"]')).toHaveCount(12);
    await expect(row.locator('[data-home-item-id]')).toHaveCount(36);
    await expect(middle.locator('[data-home-item-id]')).toHaveCount(12);
    const visibleIds = await track.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll<HTMLElement>('[data-home-item-id]')]
        .filter((item) => {
          const rect = item.getBoundingClientRect();
          return rect.right > bounds.left && rect.left < bounds.right;
        })
        .map((item) => item.dataset.homeItemId);
    });
    expect(new Set(visibleIds).size).toBe(visibleIds.length);
    await expect(
      row.locator('[data-carousel-copy="before"][aria-hidden="true"] a'),
    ).toHaveAttribute('tabindex', '-1');

    await expect(
      row.getByRole('button', { name: messages.en.home.carousel.scrollRight }),
    ).toBeEnabled();
    await expect
      .poll(() => track.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);

    await track.evaluate((element) => {
      element.scrollLeft = 0;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect
      .poll(() => track.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);

    await track.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event('scroll'));
    });
    const fullWidth = await track.evaluate((element) => element.scrollWidth);
    await expect
      .poll(() => track.evaluate((element) => element.scrollLeft))
      .toBeLessThan(fullWidth);

    const first = middle.first().locator('a');
    const last = middle.last().locator('a');
    await first.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(last).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(first).toBeFocused();

    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1100);
    for (let revolution = 0; revolution < 3; revolution += 1) {
      await track.evaluate((element) => {
        element.scrollLeft = 0;
        element.dispatchEvent(new Event('scroll'));
        element.scrollLeft = element.scrollWidth;
        element.dispatchEvent(new Event('scroll'));
      });
    }
    await expect(row.locator('[data-home-item-id]')).toHaveCount(36);
    await page.evaluate(() => {
      document.addEventListener(
        'click',
        (event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('a[href]')
          ) {
            event.preventDefault();
          }
        },
        true,
      );
    });
    await row
      .locator('[data-carousel-copy="after"]')
      .first()
      .locator('a')
      .click();
    await expect
      .poll(() => eventBodies.join('\n'))
      .toContain('"itemId":"circular-track-0"');
    await expect
      .poll(() => eventBodies.join('\n'))
      .toContain(`"rowId":"${rowId}"`);
    await expect(
      row.locator(
        '[data-carousel-copy="middle"][data-home-item-id="circular-track-0"] a',
      ),
    ).toBeFocused();
    await page.goto('/en/terms');
    await expect
      .poll(
        () =>
          eventBodies.join('\n').split('"type":"home.row_impression"').length -
          1,
      )
      .toBe(1);
    const impression = eventBodies.find((body) =>
      body.includes('"type":"home.row_impression"'),
    );
    if (!impression) throw new Error('Home row impression was not sent');
    const ids = Array.from(
      impression.matchAll(/"id":"(circular-track-\d+)"/g),
      (match) => match[1] ?? '',
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('keeps an exhausted row with no overflow as one logical set', async ({
    page,
  }) => {
    await installCircularFeed(2);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/en');
    const row = page.locator(`[data-home-row-id="${rowId}"]`);
    await expect(row.locator('[data-home-item-id]')).toHaveCount(2);
    await expect(row.locator('[data-carousel-copy]')).toHaveCount(0);
  });

  test('waits for the last item page before enabling circular presentation', async ({
    page,
  }) => {
    await installCircularFeed(24);
    await page.goto('/en');
    const row = page.locator(`[data-home-row-id="${rowId}"]`);
    const track = row.locator('ul');
    await expect(row.locator('[data-home-item-id]')).toHaveCount(12);
    await expect(row.locator('[data-carousel-copy]')).toHaveCount(0);
    await track.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(row.locator('[data-home-item-id]')).toHaveCount(72);
    await expect(
      row.locator('[data-carousel-copy="middle"] [data-home-item-id]'),
    ).toHaveCount(24);
    await expect(row.locator('[data-carousel-copy]')).toHaveCount(72);
  });
});

test.afterAll(async () => {
  await setHomeMock({
    feeds: { en: defaultHomeRows('en'), 'pt-BR': defaultHomeRows('pt-BR') },
  });
  await fetch(`${baseURL}/api/revalidate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tags: ['home:en', 'home:pt-BR'] }),
  });
});
