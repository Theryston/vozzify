import { expect, test } from '@playwright/test';
import {
  defaultHomeRows,
  type FakeHomeRow,
  setHomeMock,
} from './fake-home-api';
import { webServerEnv } from './web-server-env';

const baseURL = 'http://localhost:3000';

const card = (index: number) => ({
  id: `editorial-track-${index}`,
  title: `Editorial Track ${index}`,
  coverUrl: null,
  artistCredit: [{ name: 'Fixture Artist', joinPhrase: '' }],
  durationMs: 180_000,
  vocalRange: null,
});

async function revalidateHome() {
  const result = await fetch(`${baseURL}/api/revalidate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}` },
    body: JSON.stringify({ tags: ['home:en'] }),
  });
  if (!result.ok) throw new Error('Home cache revalidation failed');
}

test.describe.configure({ mode: 'serial' });

test.afterAll(() =>
  setHomeMock({
    feeds: { en: defaultHomeRows('en'), 'pt-BR': defaultHomeRows('pt-BR') },
  }),
);

test('renders and loads all 48 items of a Home editorial carousel', async ({
  page,
}) => {
  const visitId = `editorial-${Date.now()}`;
  const items = Array.from({ length: 48 }, (_, index) => card(index));
  const rows: FakeHomeRow[] = [
    {
      id: `hero-${visitId}`,
      layout: 'hero',
      track: { ...card(99), id: `${visitId}-hero-track` },
    },
    {
      id: `${visitId}-pin-48`,
      layout: 'standard',
      title: { key: 'home.rows.pinned', params: { title: 'Long selection' } },
      items,
    },
  ];
  await setHomeMock({ feeds: { en: rows } });
  await revalidateHome();
  await expect
    .poll(async () => (await fetch(`${baseURL}/en`)).text())
    .toContain(`/tracks/${visitId}-hero-track`);
  await page.goto('/en');

  const row = page.locator(`[data-home-row-id="${visitId}-pin-48"]`);
  const list = row.locator('ul');
  for (const lastIndex of [23, 35, 47]) {
    await list.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event('scroll'));
      element.dispatchEvent(new Event('scroll'));
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(
      row.locator(`[data-home-item-id="editorial-track-${lastIndex}"]`),
    ).toBeAttached();
  }

  const renderedIds = await row
    .locator('[data-home-item-id]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-home-item-id')),
    );
  expect(renderedIds).toEqual(items.map((item) => item.id));
});
