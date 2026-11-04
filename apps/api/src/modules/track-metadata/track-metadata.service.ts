import { Injectable, Logger, Optional } from '@nestjs/common';
import { cacheTags } from '@vozzify/contracts';
import { catalogPageTags } from '../../integrations/web-revalidation/catalog-page-tags.js';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import type { ImportMetadataJob } from '../../queue/track-metadata.job.js';
import { TracksService } from '../tracks/tracks.service.js';
import {
  type ImportedLinks,
  TrackMetadataImportService,
} from './track-metadata-import.service.js';
import { TrackMetadataProgressService } from './track-metadata-progress.service.js';

/** A failure as text, for a log line. */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs the metadata import of a Track (ADR 0005). The import runs beside the
 * Processing and never fails it: nothing here writes a Processing.
 */
@Injectable()
export class TrackMetadataService {
  private readonly logger = new Logger(TrackMetadataService.name);

  constructor(
    private readonly importer: TrackMetadataImportService,
    private readonly tracks: TracksService,
    private readonly revalidation: WebRevalidationService,
    @Optional()
    private readonly metadataProgress?: TrackMetadataProgressService,
  ) {}

  /**
   * One import attempt. A failure is thrown, so BullMQ retries it with backoff;
   * on the last attempt it is only logged, and the Track keeps what was imported.
   */
  async run(job: ImportMetadataJob, finalAttempt: boolean): Promise<void> {
    try {
      await this.metadataProgress?.markTrack(job.trackId, 'pending');
      const recordingMbid = await this.tracks.findRecordingMbid(job.trackId);
      if (recordingMbid === undefined) {
        this.logger.warn(`Track ${job.trackId} is gone: nothing to import`);
        return;
      }
      const links = await this.importer.importMetadata(
        job.trackId,
        recordingMbid,
      );
      await this.refreshPagesIfCompleted(job.trackId, links);
      await this.metadataProgress?.markTrack(job.trackId, 'completed');
    } catch (error) {
      if (!finalAttempt) {
        await this.metadataProgress?.markTrack(job.trackId, 'pending');
        throw error;
      }
      await this.metadataProgress?.markTrack(job.trackId, 'failed');
      this.logger.error(
        `Metadata of Track ${job.trackId} was not imported: ${messageOf(error)}`,
      );
    }
  }

  /**
   * Artist and Album pages list a Track only once it is completed, so a
   * completed Track's pages are refreshed here, and so is the Track's own
   * header, which links its credited names to those Artists. A Track still processing has
   * nothing to show on them yet.
   */
  private async refreshPagesIfCompleted(
    trackId: string,
    links: ImportedLinks,
  ): Promise<void> {
    if (links.artistIds.length + links.albumIds.length === 0) {
      return;
    }
    if (!(await this.tracks.isTrackCompleted(trackId))) {
      return;
    }
    await this.revalidation.revalidate(catalogPageTags(links));
    // The Track page links its credited names to the Artists just linked.
    await this.revalidation.revalidate([cacheTags.track(trackId)]);
  }
}
