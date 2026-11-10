import { expect, test } from '@playwright/test';

import {
  circularHero,
  circularTrack,
  installHomeMock,
  restoreHomeMocks,
  visibleTrackIds,
} from './home-circular-fixtures';

const baseURL = 'http://localhost:3000';
const suffix = Date.now();
const rowId = `circular-touch-row-${suffix}`;
const trackIds = Array.from(
  { length: 12 },
  (_, index) => `circular-touch-track-${suffix}-${index}`,
);
const firstTrackId = trackIds[0];
const lastTrackId = trackIds[trackIds.length - 1];

async function installTouchFeed(): Promise<void> {
  await installHomeMock({
    feeds: {
      en: [
        circularHero(`circular-touch-hero-${suffix}`, 'Circular touch hero'),
        {
          id: rowId,
          layout: 'standard',
          title: { key: 'home.rows.trendingToday', params: {} },
          items: trackIds.map((id, index) =>
            circularTrack(id, `Touch song ${index}`, 'Touch fixture'),
          ),
        },
      ],
    },
  });
}

test('native touch swipes cross both circular Home Track boundaries', async ({
  browser,
}) => {
  await installTouchFeed();
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/en');
  const row = page.locator(`[data-home-row-id="${rowId}"]`);
  const track = row.locator('ul');
  await expect(row.locator('[data-home-item-id]')).toHaveCount(36);
  await row.scrollIntoViewIfNeeded();
  const cdp = await context.newCDPSession(page);

  const swipe = async (direction: 'left' | 'right') => {
    const previous = await visibleTrackIds(track);
    const bounds = await track.boundingBox();
    if (!bounds) throw new Error('Carousel track is not visible');
    const y = bounds.y + bounds.height / 2;
    const startX =
      bounds.x + bounds.width * (direction === 'right' ? 0.7 : 0.3);
    const endX = startX + (direction === 'right' ? -140 : 140);
    const touchPoint = (x: number) => ({
      x,
      y,
      id: 1,
      radiusX: 1,
      radiusY: 1,
      force: 1,
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [touchPoint(startX)],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [touchPoint(endX)],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await page.waitForTimeout(80);
    await expect.poll(() => visibleTrackIds(track)).not.toEqual(previous);
    const visible = await visibleTrackIds(track);
    expect(new Set(visible).size).toBe(visible.length);
    return visible;
  };

  const crossBoundary = async (direction: 'left' | 'right') => {
    if (!firstTrackId || !lastTrackId) {
      throw new Error('Touch fixture Track IDs are missing');
    }
    for (let swipeCount = 0; swipeCount < 20; swipeCount += 1) {
      const visible = await swipe(direction);
      if (visible.includes(firstTrackId) && visible.includes(lastTrackId)) {
        return visible;
      }
    }
    return visibleTrackIds(track);
  };

  for (let revolution = 0; revolution < 24; revolution += 1) {
    await swipe('right');
  }
  const rightSeam = await crossBoundary('right');
  expect(rightSeam).toContain(firstTrackId);
  expect(rightSeam).toContain(lastTrackId);

  const leftSeam = await crossBoundary('left');
  expect(leftSeam).toContain(firstTrackId);
  expect(leftSeam).toContain(lastTrackId);
  expect(new Set(leftSeam).size).toBe(leftSeam.length);
  await expect(row.locator('[aria-hidden="true"] a')).toHaveCount(24);
  const hiddenTabIndexes = await row
    .locator('[aria-hidden="true"] a')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).tabIndex),
    );
  expect(hiddenTabIndexes).toEqual(Array.from({ length: 24 }, () => -1));
  await context.close();
});

test.afterAll(async () => {
  await restoreHomeMocks();
});

test('keeps keyboard focus on the logical Track after scroll recentering', async ({
  page,
}) => {
  await installTouchFeed();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en');
  const row = page.locator(`[data-home-row-id="${rowId}"]`);
  const track = row.locator('ul');
  const middle = row.locator('[data-carousel-copy="middle"]');
  await expect(middle).toHaveCount(12);
  await middle.nth(2).locator('a').focus();
  await track.evaluate((element) => {
    const first = element.children[0];
    const next = element.children[element.children.length / 3];
    if (!first || !next) throw new Error('Carousel segments are missing');
    const width =
      next.getBoundingClientRect().left - first.getBoundingClientRect().left;
    element.scrollLeft = width * 2 + 100;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(middle.nth(2).locator('a')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(middle.nth(3).locator('a')).toBeFocused();
  await middle.last().locator('a').focus();
  await page.keyboard.press('Tab');
  await expect
    .poll(() =>
      row.evaluate((element) => !element.contains(document.activeElement)),
    )
    .toBe(true);
  await expect(row.locator('[data-home-item-id]')).toHaveCount(36);
});
