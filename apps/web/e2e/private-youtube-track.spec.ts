import { expect, type Page, test } from '@playwright/test';
import type { PrivateTrackDetail } from '@vozzify/contracts';
import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';
import { messages } from './messages';

const VIDEO_ID = 'aBcd1Efgh_2';
const VIDEO_LINK = `https://youtu.be/${VIDEO_ID}?si=shared`;
const TRACK_ID = 'private_youtube_e2e';
const VIDEO_TITLE = 'Guitar rehearsal in São Paulo';
const MEDIA_URL = `https://assets.vozzify.com/storage/private-tracks/${TRACK_ID}/music.wav`;
const ROOT = '/v1/me/private-tracks';
const copy = messages.en.privateTracks;
const dock = messages.en.tracks.practice.dock;
const track = {
  id: TRACK_ID,
  title: VIDEO_TITLE,
  artist: '',
  durationMs: 20_000,
  createdAt: '2026-11-24T12:00:00.000Z',
  processing: { status: 'QUEUED', progress: 0 },
} as const;

test('submits a YouTube link from My tracks and shows its queued entry', async ({
  page,
}) => {
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  const items: (typeof track)[] = [];
  await mockSubmission(page, items);
  await page.goto('/en/me/tracks');
  await page.getByRole('button', { name: copy.newTrack }).click();
  const dialog = page.getByRole('dialog', { name: copy.newTrack });
  await dialog.getByRole('button', { name: copy.youtubeSource }).click();
  const link = dialog.getByLabel(copy.youtubeLink);
  await link.fill('invalid link');
  await dialog.getByRole('button', { name: copy.submitYouTube }).click();
  await expect(dialog.getByText(copy.invalidYouTube)).toBeVisible();
  await link.fill(VIDEO_LINK);
  await dialog.getByRole('button', { name: copy.submitYouTube }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('link', { name: VIDEO_TITLE })).toBeVisible();
  await expect(page.getByText(copy.detail.processing.QUEUED)).toBeVisible();
});

test('plays the submitted video, then continues from the same point with saved audio', async ({
  page,
  baseURL,
}, testInfo) => {
  const detail: PrivateTrackDetail = {
    ...track,
    ownerId: ADA.id,
    locked: false,
    youtubeVideoId: VIDEO_ID,
    audio: { musicMp3Url: MEDIA_URL, vocalsMp3Url: `${MEDIA_URL}?vocals` },
    processing: { status: 'COMPLETED', progress: 100 },
    notes: [{ pitch: 69, start: 5, end: 7 }],
  };
  if (!baseURL) throw new Error('Expected Playwright base URL');
  const apiUrl: unknown = testInfo.config.metadata.privateTrackApiUrl;
  await setPrivateTrackMock(
    detail,
    typeof apiUrl === 'string' ? apiUrl : undefined,
  );
  await page.context().addCookies([{ ...SIGNED_IN_COOKIE, url: baseURL }]);
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await mockYouTubePlayer(page);
  const mediaRequests: string[] = [];
  const wav = practiceWav();
  await page.route(
    (url) => url.href === MEDIA_URL,
    async (route) => {
      mediaRequests.push(route.request().url());
      const match = /^bytes=(\d+)-(\d*)$/.exec(
        route.request().headers().range ?? '',
      );
      const headers = {
        'accept-ranges': 'bytes',
        'access-control-allow-origin': '*',
        'content-type': 'audio/wav',
      };
      if (!match) {
        await route.fulfill({ headers, body: wav });
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : wav.length - 1;
      await route.fulfill({
        status: 206,
        headers: {
          ...headers,
          'content-range': `bytes ${start}-${end}/${wav.length}`,
        },
        body: wav.subarray(start, end + 1),
      });
    },
  );

  await page.goto(`/en/tracks/${TRACK_ID}`);
  await expect(page.getByRole('heading', { name: VIDEO_TITLE })).toBeVisible();
  await expect(page.getByText(copy.detail.privateBadge)).toBeVisible();
  await expect(
    page.getByTestId('dock-video').locator('iframe'),
  ).toHaveAttribute('title', VIDEO_ID);
  await page.getByRole('button', { name: dock.play, exact: true }).click();
  await expect(
    page.getByRole('button', { name: dock.pause, exact: true }),
  ).toBeVisible();
  expect(mediaRequests).toEqual([]);

  const slider = page.getByRole('slider', { name: dock.progress });
  await slider.press('ArrowRight');
  const currentTime = async () =>
    Number(await slider.getAttribute('aria-valuenow'));
  await expect.poll(currentTime).toBeGreaterThanOrEqual(5);
  const lastVideoTime = await currentTime();
  await page.evaluate(() =>
    window.dispatchEvent(new Event('test-youtube-unavailable')),
  );
  await expect(page.getByText(dock.usingSavedAudio)).toBeVisible();
  await expect(page.getByTestId('dock-video')).toHaveCount(0);
  await expect(page.getByTestId('audio-waveform')).toBeVisible();
  await expect(
    page.getByRole('button', { name: dock.pause, exact: true }),
  ).toBeVisible();
  expect(await currentTime()).toBeGreaterThanOrEqual(lastVideoTime);
  await expect.poll(currentTime).toBeGreaterThan(lastVideoTime);
  expect(mediaRequests.length).toBeGreaterThan(0);
});

async function mockSubmission(page: Page, items: (typeof track)[]) {
  await page.route(
    (url) => url.pathname === ROOT || url.pathname === `${ROOT}/youtube`,
    async (route) => {
      const request = route.request();
      const headers = {
        'access-control-allow-origin': request.headers().origin ?? '*',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
      };
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers });
        return;
      }
      if (request.method() === 'POST') {
        expect(new URL(request.url()).pathname).toBe(`${ROOT}/youtube`);
        expect(request.postDataJSON()).toEqual({ url: VIDEO_LINK });
        items.push(track);
        await route.fulfill({ status: 201, headers, json: track });
        return;
      }
      await route.fulfill({
        headers,
        json: { canSubmit: true, items, nextCursor: null },
      });
    },
  );
}

async function mockYouTubePlayer(page: Page) {
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        class Player {
          constructor(element, { events, videoId }) {
            this.events = events;
            this.seconds = 0;
            this.frame = document.createElement('iframe');
            this.frame.title = videoId;
            element.replaceWith(this.frame);
            this.fail = () => {
              this.seconds = 0;
              events.onError({ data: 150 });
            };
            window.addEventListener('test-youtube-unavailable', this.fail);
            queueMicrotask(() => events.onReady());
          }
          playVideo() { this.events.onStateChange({ data: 1 }); }
          pauseVideo() { this.events.onStateChange({ data: 2 }); }
          seekTo(seconds) { this.seconds = seconds; }
          getCurrentTime() { return this.seconds; }
          getDuration() { return 20; }
          setPlaybackRate() {}
          mute() {}
          unMute() {}
          destroy() {
            this.frame.remove();
            window.removeEventListener('test-youtube-unavailable', this.fail);
          }
        }
        window.YT = { Player };
        window.onYouTubeIframeAPIReady();
      `,
    }),
  );
}

/** A deterministic 20-second PCM stream that the browser really decodes. */
function practiceWav(): Buffer {
  const sampleRate = 8_000;
  const samples = sampleRate * 20;
  const body = Buffer.alloc(44 + samples * 2);
  body.write('RIFF', 0);
  body.writeUInt32LE(body.length - 8, 4);
  body.write('WAVEfmt ', 8);
  body.writeUInt32LE(16, 16);
  body.writeUInt16LE(1, 20);
  body.writeUInt16LE(1, 22);
  body.writeUInt32LE(sampleRate, 24);
  body.writeUInt32LE(sampleRate * 2, 28);
  body.writeUInt16LE(2, 32);
  body.writeUInt16LE(16, 34);
  body.write('data', 36);
  body.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample++) {
    body.writeInt16LE(
      Math.round(250 * Math.sin((sample * Math.PI * 880) / sampleRate)),
      44 + sample * 2,
    );
  }
  return body;
}
