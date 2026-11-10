import { expect, type Locator } from '@playwright/test';

import { defaultHomeRows, setHomeMock } from './fake-home-api';
import { webServerEnv } from './web-server-env';

const baseURL = 'http://localhost:3000';

type HomeTrackFixture = {
  id: string;
  title: string;
  coverUrl: null;
  artistCredit: { name: string; joinPhrase: string }[];
  durationMs: number;
  vocalRange: { lowest: number; highest: number } | null;
};

export function circularTrack(
  id: string,
  title: string,
  artist = 'Vozzify',
): HomeTrackFixture {
  return {
    id,
    title,
    coverUrl: null,
    artistCredit: [{ name: artist, joinPhrase: '' }],
    durationMs: 180000,
    vocalRange: { lowest: 45, highest: 64 },
  };
}

export function circularHero(id: string, title: string) {
  return {
    id,
    layout: 'hero',
    track: { ...circularTrack(id, title), vocalRange: null },
  };
}

async function revalidateHome(tags: string[]): Promise<void> {
  const response = await fetch(`${baseURL}/api/revalidate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tags }),
  });
  expect(response.ok).toBe(true);
}

export async function installHomeMock(
  state: Parameters<typeof setHomeMock>[0],
  leadTrackId?: string,
): Promise<void> {
  await setHomeMock(state);
  await revalidateHome(['home:en']);
  if (leadTrackId) {
    await expect
      .poll(async () => (await fetch(`${baseURL}/en`)).text())
      .toContain(`/en/tracks/${leadTrackId}`);
  }
}

export async function restoreHomeMocks(): Promise<void> {
  const rows = defaultHomeRows('en');
  const portugueseRows = defaultHomeRows('pt-BR');
  await setHomeMock({
    feeds: { en: rows, 'pt-BR': portugueseRows },
    personal: { en: rows, 'pt-BR': portugueseRows },
  });
  await revalidateHome(['home:en', 'home:pt-BR']);
}

export async function visibleTrackIds(track: Locator): Promise<string[]> {
  return track.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLElement>('[data-home-item-id]')]
      .filter((item) => {
        const rect = item.getBoundingClientRect();
        return rect.right > bounds.left && rect.left < bounds.right;
      })
      .map((item) => item.dataset.homeItemId ?? '');
  });
}
