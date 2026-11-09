import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { HomeFeed, Locale } from '@vozzify/contracts';
import { localeSchema } from '@vozzify/contracts';
import { z } from 'zod';
import { CacheService } from '../../redis/cache.service.js';
import { HOME_FEED_RETAINED_TTL_SECONDS } from './home-rules.js';
import { homeStoredRowSchema } from './home-stored-row.js';

const visitSchema = z.object({
  audience: z.enum(['public', 'personal']),
  locale: localeSchema,
  ownerId: z.string().min(1).nullable(),
  version: z.string().regex(/^[0-9a-f]{16}$/),
  algorithmVersion: z.number().int().positive(),
  rows: z.array(homeStoredRowSchema.nullable()),
});

export type StoredHomeVisit = z.infer<typeof visitSchema>;

const visitKey = (version: string): string => `home:visit:${version}`;

/** Frozen positions for an in-progress visit; null slots preserve gaps. */
@Injectable()
export class HomeVisitStore {
  constructor(private readonly cache: CacheService) {}

  async create(
    feed: Omit<HomeFeed, 'nextCursor'> & { locale: Locale },
    ownerId?: string,
  ): Promise<StoredHomeVisit | undefined> {
    const version = createHash('sha256')
      .update(
        JSON.stringify({
          sourceVersion: feed.version,
          audience: feed.audience,
          locale: feed.locale,
          ownerId: ownerId ?? null,
          rows: feed.rows,
        }),
      )
      .digest('hex')
      .slice(0, 16);
    const visit: StoredHomeVisit = {
      audience: feed.audience,
      locale: feed.locale,
      ownerId: ownerId ?? null,
      version,
      algorithmVersion: feed.algorithmVersion,
      rows: feed.rows,
    };
    await this.cache.set(
      visitKey(version),
      visit,
      HOME_FEED_RETAINED_TTL_SECONDS,
    );
    return this.read(version);
  }

  read(version: string): Promise<StoredHomeVisit | undefined> {
    return this.cache.get(visitKey(version), visitSchema);
  }
}
