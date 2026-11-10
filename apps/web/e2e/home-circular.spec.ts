import { expect, type Locator, test } from '@playwright/test';

import {
  circularHero,
  circularTrack,
  installHomeMock,
  restoreHomeMocks,
  visibleTrackIds,
} from './home-circular-fixtures';
import { messages } from './messages';

const baseURL = 'http://localhost:3000';
const lead = `circular-hero-${Date.now()}`;
const rowId = `circular-row-${Date.now()}`;
type CircularLayout = 'standard' | 'vocal-range';

async function installCircularFeed(
  itemCount = 12,
  options: {
    layout?: CircularLayout;
    personal?: boolean;
    itemPageFailures?: number;
    itemPrefix?: string;
  } = {},
): Promise<void> {
  const items = Array.from({ length: itemCount }, (_, index) =>
    circularTrack(
      `${options.itemPrefix ?? 'circular-track'}-${index}`,
      `Circular song ${index}`,
    ),
  );
  const row = {
    id: rowId,
    layout: options.layout ?? 'standard',
    title: { key: 'home.rows.trendingToday', params: {} },
    items,
  };
  const feed = [circularHero(lead, 'Circular hero'), row];
  const publicFeed = options.personal ? feed.slice(0, 1) : feed;
  await installHomeMock(
    {
      feeds: { en: publicFeed },
      ...(options.personal ? { personal: { en: feed } } : {}),
      itemPageFailures: options.itemPageFailures,
    },
    lead,
  );
}

async function moveByArrows(
  row: Locator,
  track: Locator,
  direction: 'left' | 'right',
  steps: number,
): Promise<void> {
  const button = row.getByRole('button', {
    name: messages.en.home.carousel[
      direction === 'left' ? 'scrollLeft' : 'scrollRight'
    ],
  });
  let visible = await visibleTrackIds(track);
  for (let step = 0; step < steps; step += 1) {
    const previous = visible;
    await expect(button).toBeEnabled();
    await button.click();
    await expect.poll(() => visibleTrackIds(track)).not.toEqual(previous);
    visible = await visibleTrackIds(track);
    expect(new Set(visible).size).toBe(visible.length);
    const previousFirst = previous[0];
    const currentFirst = visible[0];
    if (!previousFirst || !currentFirst) {
      throw new Error('Carousel movement did not expose a Track');
    }
    const previousIndex = Number(previousFirst.split('-').at(-1));
    const currentIndex = Number(currentFirst.split('-').at(-1));
    const delta =
      direction === 'right'
        ? (currentIndex - previousIndex + 12) % 12
        : (previousIndex - currentIndex + 12) % 12;
    expect(delta).toBeGreaterThan(0);
  }
}

async function wheelTrack(
  page: import('@playwright/test').Page,
  track: import('@playwright/test').Locator,
  deltaX: number,
): Promise<void> {
  const bounds = await track.boundingBox();
  if (!bounds) throw new Error('Carousel track is not visible');
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.wheel(deltaX, 0);
}

async function homeEventPayloads(
  page: import('@playwright/test').Page,
): Promise<unknown[]> {
  return page.evaluate(() => {
    const payloads = JSON.parse(
      window.localStorage.getItem('test:home-event-payloads') ?? '[]',
    ) as string[];
    return payloads.flatMap((payload) => {
      const envelope = JSON.parse(payload) as { events?: unknown[] };
      return envelope.events ?? [];
    });
  });
}

async function rowImpressionCount(
  page: import('@playwright/test').Page,
  targetRowId: string,
): Promise<number> {
  const events = await homeEventPayloads(page);
  return events.filter(
    (event) =>
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      event.type === 'home.row_impression' &&
      'rowId' in event &&
      event.rowId === targetRowId,
  ).length;
}

async function hasVisibleCanonicalFocus(
  track: import('@playwright/test').Locator,
): Promise<boolean> {
  return track.evaluate((element) => {
    const active = document.activeElement?.closest('li');
    const bounds = element.getBoundingClientRect();
    const focusBounds = active?.getBoundingClientRect();
    return (
      active?.dataset.carouselCopy === 'middle' &&
      focusBounds !== undefined &&
      focusBounds.right > bounds.left &&
      focusBounds.left < bounds.right
    );
  });
}

test.describe('exhausted Home carousels', () => {
  test('wraps geometry both ways with one accessible, attributed item set', async ({
    page,
  }) => {
    await installCircularFeed();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      const browserWindow = window as Window & {
        __homeEventPayloads?: string[];
      };
      browserWindow.__homeEventPayloads = JSON.parse(
        window.localStorage.getItem('test:home-event-payloads') ?? '[]',
      ) as string[];
      const sendBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        if (
          typeof url === 'string' &&
          url.includes('/v1/events') &&
          data instanceof Blob
        ) {
          void data.text().then((body) => {
            const payloads = browserWindow.__homeEventPayloads ?? [];
            payloads.push(body);
            browserWindow.__homeEventPayloads = payloads;
            window.localStorage.setItem(
              'test:home-event-payloads',
              JSON.stringify(payloads),
            );
          });
        }
        return sendBeacon(url, data);
      };
    });
    await page.goto('/en');
    const row = page.locator(`[data-home-row-id="${rowId}"]`);
    const track = row.locator('ul');
    const middle = row.locator('[data-carousel-copy="middle"]');
    await expect(middle).toHaveCount(12);
    await expect(row.locator('[data-carousel-copy="before"]')).toHaveCount(12);
    await expect(row.locator('[data-carousel-copy="after"]')).toHaveCount(12);
    await expect(row.locator('[data-home-item-id]')).toHaveCount(36);
    await expect(middle).toHaveCount(12);
    const visibleIds = await visibleTrackIds(track);
    expect(new Set(visibleIds).size).toBe(visibleIds.length);
    const initialHiddenTabIndexes = await row
      .locator('[data-carousel-copy="before"][aria-hidden="true"] a')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).tabIndex),
      );
    expect(initialHiddenTabIndexes).toEqual(
      Array.from({ length: 12 }, () => -1),
    );

    const scrollRight = row.getByRole('button', {
      name: messages.en.home.carousel.scrollRight,
    });
    const scrollLeft = row.getByRole('button', {
      name: messages.en.home.carousel.scrollLeft,
    });
    await expect
      .poll(() => track.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await expect(scrollRight).toBeEnabled();
    await expect(scrollLeft).toBeEnabled();

    await track.evaluate((element) => {
      const original = Object.getPrototypeOf(element).scrollBy;
      Object.defineProperty(element, 'scrollBy', {
        configurable: true,
        value: (options: ScrollToOptions) => {
          element.dataset.scrollBehavior = options.behavior ?? 'auto';
          original.call(element, options);
        },
      });
    });
    await scrollRight.click();
    await expect(track).toHaveAttribute('data-scroll-behavior', 'auto');
    await expect
      .poll(() => visibleTrackIds(track))
      .toContain('circular-track-0');
    await expect
      .poll(() => visibleTrackIds(track))
      .toContain('circular-track-11');

    await page.reload();
    const reloadedRow = page.locator(`[data-home-row-id="${rowId}"]`);
    const reloadedTrack = reloadedRow.locator('ul');
    await expect(
      reloadedRow.locator('[data-carousel-copy="middle"]'),
    ).toHaveCount(12);
    await reloadedRow.scrollIntoViewIfNeeded();
    await expect
      .poll(() => reloadedTrack.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await reloadedRow
      .getByRole('button', { name: messages.en.home.carousel.scrollLeft })
      .click();
    await expect
      .poll(() => visibleTrackIds(reloadedTrack))
      .toContain('circular-track-11');
    await expect
      .poll(() => visibleTrackIds(reloadedTrack))
      .toContain('circular-track-0');

    const reloadedMiddle = reloadedRow.locator('[data-carousel-copy="middle"]');
    const first = reloadedMiddle.first().locator('a');
    const last = reloadedMiddle.last().locator('a');
    await first.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(last).toBeFocused();
    await expect.poll(() => hasVisibleCanonicalFocus(reloadedTrack)).toBe(true);
    await page.keyboard.press('ArrowRight');
    await expect(first).toBeFocused();
    await expect.poll(() => hasVisibleCanonicalFocus(reloadedTrack)).toBe(true);

    await reloadedRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1100);
    await moveByArrows(reloadedRow, reloadedTrack, 'right', 24);
    await moveByArrows(reloadedRow, reloadedTrack, 'left', 24);
    await expect(reloadedRow.locator('[data-home-item-id]')).toHaveCount(36);
    await expect(reloadedRow.locator('[aria-hidden="true"] a')).toHaveCount(24);
    const hiddenTabIndexes = await reloadedRow
      .locator('[aria-hidden="true"] a')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).tabIndex),
      );
    expect(hiddenTabIndexes).toEqual(Array.from({ length: 24 }, () => -1));
    await reloadedTrack.evaluate((element) => {
      const last = element.querySelector<HTMLElement>(
        '[data-carousel-copy="middle"][data-home-item-id="circular-track-11"]',
      );
      if (!last) throw new Error('Last logical Track is not rendered');
      const bounds = element.getBoundingClientRect();
      element.scrollLeft += last.getBoundingClientRect().left - bounds.left;
    });
    await expect
      .poll(() => visibleTrackIds(reloadedTrack))
      .toContain('circular-track-0');
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
    const visibleCopy = await reloadedTrack.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const visibleClone = [
        ...element.querySelectorAll<HTMLElement>(
          'li[data-home-item-id="circular-track-0"]',
        ),
      ].find((item) => {
        const rect = item.getBoundingClientRect();
        return (
          item.dataset.carouselCopy !== 'middle' &&
          rect.right > bounds.left &&
          rect.left < bounds.right
        );
      });
      return visibleClone?.dataset.carouselCopy;
    });
    if (!visibleCopy) throw new Error('Visible visual clone was not found');
    const clickedCloneLink = await reloadedRow
      .locator(
        `[data-carousel-copy="${visibleCopy}"][data-home-item-id="circular-track-0"] a`,
      )
      .elementHandle();
    if (!clickedCloneLink)
      throw new Error('Visual clone link was not rendered');
    await clickedCloneLink.click();
    await expect
      .poll(async () => JSON.stringify(await homeEventPayloads(page)))
      .toContain('"itemId":"circular-track-0"');
    await expect
      .poll(async () => JSON.stringify(await homeEventPayloads(page)))
      .toContain(`"rowId":"${rowId}"`);
    await expect
      .poll(() => clickedCloneLink.getAttribute('href'))
      .toContain('clickId=');
    await expect(
      reloadedRow.locator(
        '[data-carousel-copy="middle"][data-home-item-id="circular-track-0"] a',
      ),
    ).toBeFocused();
    await expect
      .poll(() => rowImpressionCount(page, rowId), { timeout: 7000 })
      .toBe(1);
    await page.goto('/en/terms');
    await expect.poll(() => rowImpressionCount(page, rowId)).toBe(1);
    const impression = (await homeEventPayloads(page)).find(
      (event) =>
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        event.type === 'home.row_impression' &&
        'rowId' in event &&
        event.rowId === rowId,
    );
    if (
      !impression ||
      typeof impression !== 'object' ||
      !('items' in impression) ||
      !Array.isArray(impression.items)
    ) {
      throw new Error('Home row impression was not sent');
    }
    const ids = impression.items.flatMap((item) =>
      typeof item === 'object' &&
      item !== null &&
      'id' in item &&
      typeof item.id === 'string'
        ? [item.id]
        : [],
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

  test('keeps focus on the logical Track when its final item page enables looping', async ({
    page,
  }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/v1/home/rows/${rowId}/items**`, async (route) => {
      await gate;
      await route.continue();
    });
    await installCircularFeed(24);
    try {
      await page.goto('/en');
      const row = page.locator(`[data-home-row-id="${rowId}"]`);
      const card = row.locator('[data-home-item-id="circular-track-2"] a');
      await expect(row.locator('[data-carousel-copy]')).toHaveCount(0);
      await card.focus();
      release();
      await expect(row.locator('[data-carousel-copy="middle"]')).toHaveCount(
        24,
      );
      await expect(
        row.locator(
          '[data-carousel-copy="middle"][data-home-item-id="circular-track-2"] a',
        ),
      ).toBeFocused();
    } finally {
      release();
    }
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
    await wheelTrack(page, track, 1600);
    await expect(row.locator('[data-home-item-id]')).toHaveCount(72);
    await expect(
      row.locator('[data-carousel-copy="middle"][data-home-item-id]'),
    ).toHaveCount(24);
    await expect(row.locator('[data-carousel-copy]')).toHaveCount(72);
  });

  test('stays finite after a horizontal page error and loops after retry', async ({
    page,
  }) => {
    await installCircularFeed(24, { itemPageFailures: 1 });
    await page.goto('/en');
    const row = page.locator(`[data-home-row-id="${rowId}"]`);
    await row.scrollIntoViewIfNeeded();
    await wheelTrack(page, row.locator('ul'), 1600);
    await expect(row.getByRole('alert')).toBeVisible();
    await expect(row.locator('[data-carousel-copy]')).toHaveCount(0);

    await row
      .getByRole('button', { name: messages.en.home.carousel.retryItems })
      .click();
    await expect(row.locator('[data-carousel-copy="middle"]')).toHaveCount(24);
    await expect(row.locator('[data-carousel-copy]')).toHaveCount(72);
  });

  test('restarts an expired item-page visit before enabling the loop', async ({
    page,
  }) => {
    await installCircularFeed(24, { itemPrefix: 'expired-track' });
    await page.setViewportSize({ width: 1440, height: 320 });
    await page.goto('/en');
    const row = page.locator(`[data-home-row-id="${rowId}"]`);
    await expect(
      row.locator('[data-home-item-id="expired-track-0"]'),
    ).toBeAttached();
    await installCircularFeed(24, { itemPrefix: 'fresh-track' });
    const expiredPage = page.waitForResponse(
      (response) =>
        response.url().includes(`/v1/home/rows/${rowId}/items`) &&
        response.status() === 404,
    );
    await row.scrollIntoViewIfNeeded();
    await expiredPage;
    await expect(
      row.locator(
        '[data-carousel-copy="middle"][data-home-item-id="fresh-track-0"]',
      ),
    ).toBeAttached();
    await expect(
      row.locator('[data-home-item-id^="expired-track-"]'),
    ).toHaveCount(0);
    await expect(row.locator('[data-carousel-copy="middle"]')).toHaveCount(24);
    await expect(row.locator('[data-carousel-copy]')).toHaveCount(72);
  });

  test('keeps personal Vocal-range rows circular and copies hidden from AT', async ({
    page,
    context,
  }) => {
    await installCircularFeed(12, { layout: 'vocal-range', personal: true });
    await context.addCookies([
      { name: 'vozzify.session_token', value: 'signed-in', url: baseURL },
    ]);
    await page.goto('/en');
    const row = page.locator(`[data-home-row-id="${rowId}"]`);
    await expect(row.locator('[data-carousel-copy="middle"]')).toHaveCount(12);
    await expect(
      row.locator('[data-carousel-copy="before"][aria-hidden="true"]'),
    ).toHaveCount(12);
    await expect(
      row.locator('[data-carousel-copy="after"][aria-hidden="true"]'),
    ).toHaveCount(12);
    await expect(row.locator('[data-home-item-id]')).toHaveCount(36);
    const hiddenTabIndexes = await row
      .locator('[data-carousel-copy="after"] a')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).tabIndex),
      );
    expect(hiddenTabIndexes).toEqual(Array.from({ length: 12 }, () => -1));
  });
});

test.afterAll(async () => {
  await restoreHomeMocks();
});
