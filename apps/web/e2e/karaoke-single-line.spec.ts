import { expect, test } from '@playwright/test';
import { setTrackMock } from './fake-track-api';
import { messages } from './messages';

const words =
  'A long lyric segment that must be split into smaller parts while keeping every word synchronized with the music'.split(
    ' ',
  );

test('keeps long karaoke segments on one line in fullscreen and after resizing', async ({
  page,
}) => {
  const id = 'clx-karaoke-single-line';
  await setTrackMock({
    tracks: [
      {
        id,
        title: 'Long lyrics',
        durationMs: 60_000,
        youtubeVideoId: 'dQw4w9WgXcQ',
        processing: { status: 'COMPLETED' },
        notes: [{ pitch: 60, start: 0, end: 60 }],
        lyrics: [
          {
            start: 0,
            end: words.length,
            words: words.map((text, index) => ({
              text,
              start: index,
              end: index + 1,
            })),
          },
        ],
      },
    ],
  });
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto(`/en/tracks/${id}`);
  const slot = page.getByTestId('karaoke-line');
  await expect(slot).toBeVisible();
  const fullscreen = page.getByRole('button', {
    name: messages.en.tracks.practice.listening.fullscreen,
  });
  for (const width of [640, 480, 800]) {
    await page.setViewportSize({ width, height: 360 });
    await fullscreen.click();
    await expect
      .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
      .toBe(true);
    const slider = page.getByRole('slider', {
      name: messages.en.tracks.practice.dock.progress,
    });
    await slider.press('Home');
    await slider.press('ArrowRight');
    await slider.press('ArrowRight');
    await expect(slot.locator('[data-state="current"]')).toHaveText(
      words[10] ?? '',
    );
    await expect
      .poll(() =>
        slot.evaluate((element) => {
          const text = element.firstElementChild;
          if (!text) return false;
          const range = document.createRange();
          range.selectNodeContents(text);
          const bounds = range.getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return (
            bounds.height <= 32 &&
            bounds.left >= box.left - 1 &&
            bounds.right <= box.right + 1
          );
        }),
      )
      .toBe(true);
    await expect(slot).toHaveCSS('height', '32px');
    await fullscreen.click();
    await expect
      .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
      .toBe(false);
  }
});
