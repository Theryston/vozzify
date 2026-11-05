import { Injectable } from '@nestjs/common';
import { TrackMetadataProgressService } from '../track-metadata/track-metadata-progress.service.js';
import { LegacyCatalogEntity } from './legacy-catalog-entities.js';
import { LegacyCatalogMapRepository } from './legacy-catalog-map.repository.js';
import { LegacySourceRepository } from './legacy-source.repository.js';

export type LegacyCatalogMapInputs = {
  plans: Array<
    Awaited<ReturnType<LegacyCatalogMapRepository['findPlans']>>[number] & {
      metadataStatus: string | null;
    }
  >;
  artists: LegacyCatalogEntity[];
  albums: LegacyCatalogEntity[];
};

/** Loads durable destination plans and the authoritative read-only source inventory. */
@Injectable()
export class LegacyCatalogMapInputService {
  constructor(
    private readonly plans: LegacyCatalogMapRepository,
    private readonly progress: TrackMetadataProgressService,
    private readonly source: LegacySourceRepository,
  ) {}

  async load(): Promise<LegacyCatalogMapInputs> {
    const plans = await this.plans.findPlans();
    const trackIds = [
      ...new Set(plans.flatMap((plan) => (plan.trackId ? [plan.trackId] : []))),
    ];
    const statuses = await this.progress.findStatuses(trackIds);
    const sourceEntities = await this.source.snapshot(async (snapshot) => ({
      artists: await readPages((cursor) => snapshot.artistPage(cursor)),
      albums: await readPages((cursor) => snapshot.albumPage(cursor)),
    }));
    return {
      plans: plans.map((plan) => ({
        ...plan,
        metadataStatus: plan.trackId
          ? (statuses.get(plan.trackId) ?? 'pending')
          : null,
      })),
      ...sourceEntities,
    };
  }
}

const readPages = async <T extends { id: string }>(
  page: (cursor: string | null) => Promise<T[]>,
): Promise<T[]> => {
  const items: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const results = await page(cursor);
    if (results.length === 0) return items;
    items.push(...results);
    cursor = results.at(-1)?.id ?? null;
  }
};
