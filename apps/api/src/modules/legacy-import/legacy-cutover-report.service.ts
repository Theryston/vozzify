import { Injectable } from '@nestjs/common';
import type { EntityMapReport } from './legacy-catalog-map-report.js';
import { LegacyCutoverRepository } from './legacy-cutover.repository.js';
import { cutoverInventory } from './legacy-cutover-inventory.js';
import { reconcileCutover } from './legacy-cutover-report.js';
import { LegacySourceRepository } from './legacy-source.repository.js';

@Injectable()
export class LegacyCutoverReportService {
  constructor(
    private readonly source: LegacySourceRepository,
    private readonly destination: LegacyCutoverRepository,
  ) {}

  async inspect(maps?: { artists: EntityMapReport; albums: EntityMapReport }) {
    const { inventory, fingerprints } =
      await this.source.snapshot(cutoverInventory);
    const saved = await this.destination.read();
    for (const [progress, digest] of [
      [saved.users, fingerprints.users],
      [saved.personal, fingerprints.personal],
      [saved.plan, fingerprints.recordings],
      [saved.relationships, fingerprints.relationships],
    ] as const) {
      if (progress && progress.sourceDigest !== digest)
        inventory.errors.push('SOURCE_CHANGED');
    }
    return {
      ...reconcileCutover(inventory, saved, maps),
      planComplete: saved.planComplete,
    };
  }
}
