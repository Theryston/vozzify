import type { TestingModuleBuilder } from '@nestjs/testing';
import type { z } from 'zod';
import { CacheService } from '../../src/redis/cache.service.js';

/** Keeps snapshots available across requests, like the shared production cache. */
export class MemoryCache {
  private readonly entries = new Map<string, unknown>();

  async get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    const parsed = schema.safeParse(this.entries.get(key));
    return parsed.success ? parsed.data : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.entries.set(key, value);
  }

  async acquire(): Promise<boolean> {
    return true;
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const withMemoryCache = (
  builder: TestingModuleBuilder,
  cache: MemoryCache,
) => builder.overrideProvider(CacheService).useValue(cache);
