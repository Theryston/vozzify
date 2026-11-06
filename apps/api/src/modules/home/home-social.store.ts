import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CacheService } from '../../redis/cache.service.js';
import { redisKey } from '../../redis/redis.constants.js';

const socialPairSchema = z.object({
  id: z.string().min(1).max(64),
  username: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  image: z.string().min(1).max(2000).nullable(),
  practiceCommonTracks: z.number().int().nonnegative(),
  favoriteCommonTracks: z.number().int().nonnegative(),
  bothCommonTracks: z.number().int().nonnegative(),
  viewerTrackCount: z.number().int().nonnegative().optional(),
  practiceTrackCount: z.number().int().nonnegative().optional(),
  favoriteTrackCount: z.number().int().nonnegative().optional(),
  bothTrackCount: z.number().int().nonnegative().optional(),
  practiceLastActivityAt: z.string().datetime().nullable().optional(),
  favoriteLastActivityAt: z.string().datetime().nullable().optional(),
  vocalDistance: z.number().nonnegative().nullable(),
});

const storedSocialPairsSchema = z.array(socialPairSchema).max(500);
export type StoredSocialPair = z.infer<typeof socialPairSchema>;

const keyOf = (userId: string): string =>
  redisKey('home-social-similarity', userId);
const SOCIAL_SNAPSHOT_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Batch-owned user-pair similarities consumed by personal feed generators. */
@Injectable()
export class HomeSocialStore {
  constructor(private readonly cache: CacheService) {}

  read(viewerId: string): Promise<StoredSocialPair[] | undefined> {
    return this.cache.get(keyOf(viewerId), storedSocialPairsSchema);
  }

  write(viewerId: string, pairs: StoredSocialPair[]): Promise<void> {
    return this.cache.set(keyOf(viewerId), pairs, SOCIAL_SNAPSHOT_TTL_SECONDS);
  }
}
