import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { Injectable } from '@nestjs/common';
import type { HomeRow, Locale } from '@vozzify/contracts';
import { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';
import { CacheService } from '../../redis/cache.service.js';
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import type { OverlayPin } from './home-pin-overlay.js';
import {
  HOME_ALGORITHM_VERSION,
  HOME_FEED_LOCK_TTL_SECONDS,
  HOME_FEED_RETAINED_TTL_SECONDS,
  HOME_MAX_ROWS,
} from './home-rules.js';
import { homeStoredRowSchema } from './home-stored-row.js';

type PublicOverlayInput = {
  rows: HomeRow[];
  candidates?: HomeCompositionCandidateRow[];
  pins: readonly OverlayPin[];
  locale: Locale;
  sourceVersion?: string;
};

const rowsSchema = z.array(homeStoredRowSchema).max(HOME_MAX_ROWS);
const OVERLAY_WAIT_MS = 2_000;
const overlayKey = (input: PublicOverlayInput): string => {
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        algorithmVersion: HOME_ALGORITHM_VERSION,
        source: input.sourceVersion ?? {
          rows: input.rows,
          candidates: input.candidates,
        },
        locale: input.locale,
        pins: input.pins,
      }),
    )
    .digest('hex');
  return `home:public-overlay:${hash}`;
};

/** Shares one cold live-Pin composition across public visits and instances. */
@Injectable()
export class HomePublicOverlayCache {
  private readonly pending = new Map<string, Promise<HomeRow[]>>();

  constructor(private readonly cache: CacheService) {}

  read(input: PublicOverlayInput): Promise<HomeRow[] | undefined> {
    return this.cache.get(overlayKey(input), rowsSchema);
  }

  async resolve(
    input: PublicOverlayInput,
    build: () => Promise<HomeRow[]>,
  ): Promise<HomeRow[]> {
    const key = overlayKey(input);
    const pending = this.pending.get(key);
    if (pending !== undefined) return pending;
    const result = this.resolveShared(key, build);
    this.pending.set(key, result);
    try {
      return await result;
    } finally {
      this.pending.delete(key);
    }
  }

  private async resolveShared(
    key: string,
    build: () => Promise<HomeRow[]>,
  ): Promise<HomeRow[]> {
    const deadline = Date.now() + OVERLAY_WAIT_MS;
    let delay = 25;
    while (Date.now() < deadline) {
      const cached = await this.cache.get(key, rowsSchema);
      if (cached !== undefined) return cached;
      if (await this.cache.acquire(`${key}:lock`, HOME_FEED_LOCK_TTL_SECONDS)) {
        const rows = await build();
        await this.cache.set(key, rows, HOME_FEED_RETAINED_TTL_SECONDS);
        return rows;
      }
      // The NX lease expires if its holder crashes. Do not delete a lease
      // after building: an expired holder must not unlock a newer builder.
      await setTimeout(delay);
      delay = Math.min(delay * 2, 250);
    }
    throw new AppException(
      'SERVICE_UNAVAILABLE',
      'The public Home overlay is being refreshed; retry shortly',
    );
  }
}
