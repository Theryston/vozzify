import { Test } from '@nestjs/testing';
import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import type { z } from 'zod';
import { CacheService } from '../../redis/cache.service.js';
import type { OverlayPin } from './home-pin-overlay.js';
import { HomePublicOverlayCache } from './home-public-overlay-cache.js';

const track: HomeTrack = {
  id: 'track',
  title: 'Track',
  coverUrl: null,
  artistCredit: [],
  durationMs: null,
  vocalRange: null,
};
const rows: HomeRow[] = [{ id: 'hero', layout: 'hero', track }];

const openCache = async () => {
  const values = new Map<string, unknown>();
  const locks = new Set<string>();
  const cache = {
    get: vi.fn(async (key: string, schema: z.ZodType<HomeRow[]>) => {
      const parsed = schema.safeParse(values.get(key));
      return parsed.success ? parsed.data : undefined;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    acquire: vi.fn(async (key: string) => {
      if (locks.has(key)) return false;
      locks.add(key);
      return true;
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      HomePublicOverlayCache,
      { provide: CacheService, useValue: cache },
    ],
  }).compile();
  return {
    moduleRef,
    cache,
    locks,
    overlay: moduleRef.get(HomePublicOverlayCache),
  };
};

it('shares a cold public overlay across concurrent callers and cached reads', async () => {
  const { moduleRef, overlay } = await openCache();
  const build = vi.fn(async () => rows);
  const input = { rows, pins: [], locale: 'en' as const };
  try {
    expect(
      await Promise.all(
        Array.from({ length: 10 }, () => overlay.resolve(input, build)),
      ),
    ).toEqual(Array.from({ length: 10 }, () => rows));
    expect(build).toHaveBeenCalledTimes(1);
    expect(await overlay.resolve(input, build)).toEqual(rows);
    expect(build).toHaveBeenCalledTimes(1);
    expect(await overlay.resolve({ ...input, locale: 'pt-BR' }, build)).toEqual(
      rows,
    );
    expect(build).toHaveBeenCalledTimes(2);
  } finally {
    await moduleRef.close();
  }
});

it('waits for a different instance holding the NX lease to publish complete Rows', async () => {
  const { moduleRef, overlay, cache } = await openCache();
  const peer = new HomePublicOverlayCache(moduleRef.get(CacheService));
  let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const build = vi.fn(async () => {
    await ready;
    return rows;
  });
  const input = { rows, pins: [], locale: 'en' as const };
  try {
    const first = overlay.resolve(input, build);
    const second = peer.resolve(input, build);
    await vi.waitFor(() =>
      expect(cache.acquire.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    release?.();
    expect(await Promise.all([first, second])).toEqual([rows, rows]);
    expect(build).toHaveBeenCalledTimes(1);
  } finally {
    release?.();
    await moduleRef.close();
  }
});

it('keys the shared overlay by feed version and ordered live Pin contents', async () => {
  const { moduleRef, overlay } = await openCache();
  const pin: OverlayPin = {
    id: 'pin',
    kind: 'row',
    position: 1,
    priority: 0,
    createdAt: 0,
    sponsored: false,
    title: { key: 'home.rows.pinned', params: { title: 'First' } },
    tracks: [track],
  };
  const second = {
    ...pin,
    id: 'second',
    tracks: pin.tracks.map((track) => ({ ...track, id: 'second' })),
  };
  const input = {
    rows,
    pins: [pin, second],
    locale: 'en' as const,
    sourceVersion: 'version-1',
  };
  const build = vi.fn(async () => rows);
  try {
    await overlay.resolve(input, build);
    await overlay.resolve(input, build);
    expect(build).toHaveBeenCalledTimes(1);
    await overlay.resolve({ ...input, sourceVersion: 'version-2' }, build);
    await overlay.resolve({ ...input, pins: [second, pin] }, build);
    await overlay.resolve(
      { ...input, pins: [{ ...pin, sponsored: true }, second] },
      build,
    );
    await overlay.resolve(
      {
        ...input,
        pins: [{ ...pin, tracks: [...pin.tracks, ...second.tracks] }, second],
      },
      build,
    );
    await overlay.resolve(
      {
        ...input,
        pins: [
          { ...pin, title: { ...pin.title, params: { title: 'Edited' } } },
          second,
        ],
      },
      build,
    );
    expect(build).toHaveBeenCalledTimes(6);
  } finally {
    await moduleRef.close();
  }
});

it('forgets a failed local builder so a retry can proceed after lease expiry', async () => {
  const { moduleRef, overlay, locks } = await openCache();
  const build = vi
    .fn()
    .mockRejectedValueOnce(new Error('source unavailable'))
    .mockResolvedValue(rows);
  const input = { rows, pins: [], locale: 'en' as const };
  try {
    await expect(overlay.resolve(input, build)).rejects.toThrow(
      'source unavailable',
    );
    locks.clear();
    await expect(overlay.resolve(input, build)).resolves.toEqual(rows);
    expect(build).toHaveBeenCalledTimes(2);
  } finally {
    await moduleRef.close();
  }
});

it('returns a retryable error rather than partial contents when the NX holder is stalled', async () => {
  const { moduleRef, overlay, cache } = await openCache();
  cache.acquire.mockResolvedValue(false);
  const clock = vi
    .spyOn(Date, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValue(3_000);
  const build = vi.fn(async () => rows);
  try {
    await expect(
      overlay.resolve({ rows, pins: [], locale: 'en' }, build),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(build).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
    await moduleRef.close();
  }
});
