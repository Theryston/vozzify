import { expect, test } from '@playwright/test';

import { defaultHomeRows, setHomeMock } from './fake-home-api';
import { webServerEnv } from './web-server-env';

const titles = ['Your Love Is My Favourite Band (acoustic)', 'A'.repeat(120)];
let sequence = 0;

// Feed fixtures and cache tags are shared with the other home suites.
test.describe.configure({ mode: 'serial' });

async function revalidateHome() {
  const response = await fetch('http://localhost:3000/api/revalidate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tags: ['home:pt-BR'] }),
  });
  expect(response.ok).toBe(true);
}

test.afterAll(async () => {
  await setHomeMock({ feeds: { 'pt-BR': defaultHomeRows('pt-BR') } });
  await revalidateHome();
});

for (const width of [320, 360, 390, 640, 768, 1024, 1440]) {
  test(`hero keeps long titles clear of the cover at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const title of titles) {
      const id = `hero-layout-${++sequence}`;
      await setHomeMock({
        feeds: {
          'pt-BR': [
            {
              id: 'hero',
              layout: 'hero',
              track: {
                id,
                title,
                coverUrl: null,
                artistCredit: [{ name: 'The Vaccines', joinPhrase: '' }],
                durationMs: 180000,
                vocalRange: { lowest: 45, highest: 64 },
              },
            },
          ],
        },
      });
      await revalidateHome();
      await expect
        .poll(async () => {
          const response = await fetch('http://localhost:3000/pt-BR');
          return response.text();
        })
        .toContain(`/pt-BR/tracks/${id}`);
      await page.goto('/pt-BR');
      const hero = page.locator('section[aria-labelledby="home-hero-title"]');
      await expect(
        hero.getByRole('heading', { level: 2, name: title }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const geometry = await hero.evaluate((element) => {
        const cover = element.querySelector('[aria-hidden="true"]');
        const title = element.querySelector('h2');
        if (!cover || !title) throw new Error('Hero content is missing');
        const image = cover.getBoundingClientRect();
        const text = title.getBoundingClientRect();
        return {
          overlaps:
            text.left < image.right &&
            text.right > image.left &&
            text.top < image.bottom &&
            text.bottom > image.top,
          titleFits: title.scrollWidth <= title.clientWidth,
          pageFits: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
      expect(geometry.overlaps).toBe(false);
      expect(geometry.titleFits).toBe(true);
      expect(geometry.pageFits).toBe(true);
      if (title === titles[0]) {
        await hero.screenshot({ path: testInfo.outputPath('long-title.png') });
      }
    }
  });
}
