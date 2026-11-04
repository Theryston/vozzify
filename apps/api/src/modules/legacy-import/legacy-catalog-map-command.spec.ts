import { NestFactory } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLegacyCatalogMapEnv } from '../../config/env.js';
import { runLegacyCatalogMap } from './legacy-catalog-map-command.js';

vi.mock('@nestjs/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@nestjs/core')>();
  return {
    ...original,
    NestFactory: {
      ...original.NestFactory,
      createApplicationContext: vi.fn(),
    },
  };
});
vi.mock('../../config/env.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../config/env.js')>();
  return { ...original, loadLegacyCatalogMapEnv: vi.fn() };
});

const pendingResult = {
  artists: {
    mapped: 0,
    unresolved: 0,
    pending: 1,
    unresolvedItems: [],
    pendingItems: [
      { legacyId: 'old-artist', reason: 'metadata-import-pending' },
    ],
  },
  albums: {
    mapped: 0,
    unresolved: 1,
    pending: 0,
    unresolvedItems: [{ legacyId: 'old-album', reason: 'no-match' }],
    pendingItems: [],
  },
};

describe('runLegacyCatalogMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadLegacyCatalogMapEnv).mockReturnValue({
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/test',
      LEGACY_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/source',
      REDIS_URL: 'redis://127.0.0.1:1',
    } as never);
  });

  it('closes the operator context after reporting mapped, skipped, and pending sources', async () => {
    const reconcile = vi.fn().mockResolvedValue(pendingResult);
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(NestFactory.createApplicationContext).mockResolvedValue({
      get: () => ({ reconcile }),
      close,
    } as never);

    await expect(
      runLegacyCatalogMap(['--import-legacy-catalog-maps']),
    ).resolves.toBe(true);
    expect(reconcile).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the context and returns failure when reconciliation throws', async () => {
    const reconcile = vi.fn().mockRejectedValue(new Error('database offline'));
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(NestFactory.createApplicationContext).mockResolvedValue({
      get: () => ({ reconcile }),
      close,
    } as never);

    await expect(
      runLegacyCatalogMap(['--import-legacy-catalog-maps']),
    ).resolves.toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it('refuses other arguments before opening the operator context', async () => {
    await expect(runLegacyCatalogMap([])).resolves.toBe(false);
    expect(NestFactory.createApplicationContext).not.toHaveBeenCalled();
  });

  it('returns failure when the operator environment is invalid', async () => {
    vi.mocked(loadLegacyCatalogMapEnv).mockImplementation(() => {
      throw new Error('invalid environment');
    });

    await expect(
      runLegacyCatalogMap(['--import-legacy-catalog-maps']),
    ).resolves.toBe(false);
    expect(NestFactory.createApplicationContext).not.toHaveBeenCalled();
  });
});
