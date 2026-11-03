import { Injectable, Logger } from '@nestjs/common';
import { cacheTags, type Recording } from '@vozzify/contracts';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { TrackCoverService } from './track-cover.service.js';
import {
  TrackCoverRepairRepository,
  type TrackCoverRepairRow,
} from './track-cover-repair.repository.js';
import { messageOf } from './track-processing-failure.js';

const PAGE_SIZE = 100;
const MAX_MERGE_HOPS = 3;

/** Operator repair: recover the catalog's cover choice without reprocessing audio. */
@Injectable()
export class TrackCoverRepairService {
  private readonly logger = new Logger(TrackCoverRepairService.name);

  constructor(
    private readonly tracks: TrackCoverRepairRepository,
    private readonly catalog: MusicCatalogClient,
    private readonly covers: TrackCoverService,
    private readonly revalidation: WebRevalidationService,
  ) {}

  async repair(): Promise<void> {
    let afterId: string | undefined;
    let processed = 0;
    const failures: unknown[] = [];
    for (;;) {
      const page = await this.tracks.page(afterId, PAGE_SIZE);
      if (page.length === 0) break;
      for (const track of page) {
        try {
          await this.repairTrack(track);
        } catch (error) {
          failures.push(error);
          this.logger.warn(
            `Cover repair failed for Track ${track.id}: ${messageOf(error)}`,
          );
        }
        processed += 1;
      }
      afterId = page.at(-1)?.id;
    }
    this.logger.log(
      `Cover repair checked ${processed} Tracks; ${failures.length} failed`,
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Cover repair failed for ${failures.length} of ${processed} Tracks`,
      );
    }
  }

  private async repairTrack(track: TrackCoverRepairRow): Promise<void> {
    const recording = await this.resolveRecording(track.recordingMbid);
    await this.covers.repairCover(
      track.id,
      recording.releases[0]?.mbid ?? null,
    );
    // A rerun must repair cache delivery even if the cover was already saved.
    await this.revalidation.revalidate([
      cacheTags.track(track.id),
      cacheTags.tracks,
    ]);
  }

  private async resolveRecording(initialMbid: string): Promise<Recording> {
    const seen = new Set<string>();
    let mbid = initialMbid;
    for (let hops = 0; hops <= MAX_MERGE_HOPS; hops += 1) {
      if (seen.has(mbid)) break;
      seen.add(mbid);
      const lookup = await this.catalog.getRecording(mbid);
      if (lookup.status === 'found') return lookup.recording;
      if (lookup.status === 'not-found') {
        throw new Error(`Recording ${mbid} not found`);
      }
      mbid = lookup.newMbid;
    }
    throw new Error(`Recording ${initialMbid} has an unresolved merge chain`);
  }
}
