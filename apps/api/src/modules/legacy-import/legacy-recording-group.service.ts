import { Injectable } from '@nestjs/common';
import type { Mbid } from '@vozzify/contracts';
import { TrackMigrationService } from '../tracks/track-migration.service.js';
import { LegacyRecordingGroupRepository } from './legacy-recording-group.repository.js';

@Injectable()
export class LegacyRecordingGroupService {
  constructor(
    private readonly groups: LegacyRecordingGroupRepository,
    private readonly tracks: TrackMigrationService,
  ) {}

  async prepare(recordingMbid: Mbid) {
    const { sourceDigest, ...group } = await this.groups.group(recordingMbid);
    const prepared = await this.tracks.prepare({ recordingMbid, ...group });
    await this.groups.acknowledge({
      id: recordingMbid,
      sourceDigest,
      ...prepared,
      processingId: prepared.initialProcessingId,
    });
    return prepared;
  }

  async start(recordingMbid: Mbid): Promise<void> {
    const progress = await this.progress(recordingMbid);
    await this.tracks.start(progress.trackId, progress.processingId);
  }

  async retry(recordingMbid: Mbid): Promise<void> {
    const progress = await this.progress(recordingMbid);
    const processingId = await this.tracks.retry(
      progress.trackId,
      progress.processingId,
      recordingMbid,
    );
    await this.groups.acknowledgeRetry(
      recordingMbid,
      progress.processingId,
      processingId,
    );
    await this.tracks.start(progress.trackId, processingId);
  }

  private async progress(recordingMbid: Mbid) {
    const group = await this.groups.group(recordingMbid);
    const progress = await this.groups.find(recordingMbid);
    if (!progress) throw new Error('RECORDING_GROUP_NOT_PREPARED');
    if (progress.sourceDigest !== group.sourceDigest)
      throw new Error('SOURCE_CHANGED');
    return progress;
  }
}
