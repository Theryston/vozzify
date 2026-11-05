import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Mbid, Recording } from '@vozzify/contracts';
import { trackRowsFromRecording } from './track-from-recording.js';
import { TrackMigrationRepository } from './track-migration.repository.js';
import { TrackProcessingRepository } from './track-processing.repository.js';
import { TrackRequestService } from './track-request.service.js';
import { TracksRepository } from './tracks.repository.js';

export type MigrationGroup = {
  recordingMbid: Mbid;
  userId: string;
  contributedAt: Date;
  legacyTrackIds: string[];
};

export type PreparedMigration = {
  trackId: string;
  initialProcessingId: string;
};

@Injectable()
export class TrackMigrationPreparationService {
  constructor(
    private readonly requests: TrackRequestService,
    private readonly tracks: TracksRepository,
    private readonly processings: TrackProcessingRepository,
    private readonly migrations: TrackMigrationRepository,
  ) {}

  async prepare(group: MigrationGroup): Promise<PreparedMigration> {
    const recording = await this.requests.resolveRecording(group.recordingMbid);
    // A plan is frozen: a new catalog merge requires an operator to replan it.
    if (recording.mbid !== group.recordingMbid)
      throw new Error('RECORDING_PLAN_CHANGED');
    return this.persist(group, recording);
  }

  @Transactional()
  private async persist(
    group: MigrationGroup,
    recording: Recording,
  ): Promise<PreparedMigration> {
    await this.migrations.lock(group.recordingMbid);
    const { track, ...details } = trackRowsFromRecording(recording);
    const trackId = await this.tracks.insertTrack(track);
    if (trackId === undefined) return this.recover(group);
    await this.tracks.insertTrackDetails(trackId, details);
    await this.tracks.insertAssociationEvent(recording.mbid, trackId);
    const initialProcessingId =
      await this.processings.insertQueuedProcessing(trackId);
    await this.migrations.attribute(trackId, initialProcessingId, group);
    await this.migrations.mark(initialProcessingId, group.recordingMbid);
    await this.migrations.map(trackId, group.legacyTrackIds);
    return { trackId, initialProcessingId };
  }

  async assertAttempt(
    trackId: string,
    expectedProcessingId: string,
  ): Promise<void> {
    const current = await this.processings.findLatestProcessing(trackId);
    if (
      current?.id !== expectedProcessingId ||
      !(await this.migrations.isMigration(expectedProcessingId))
    ) {
      throw new Error('MIGRATION_PROCESSING_CHANGED');
    }
  }

  private async recover(group: MigrationGroup): Promise<PreparedMigration> {
    const trackId = (
      await this.tracks.findTrackIdsByRecordingMbids([group.recordingMbid])
    ).get(group.recordingMbid);
    if (trackId === undefined) throw new Error('MIGRATION_TRACK_NOT_FOUND');
    const initial = await this.migrations.initial(trackId);
    if (
      initial?.userId !== group.userId ||
      initial.contributedAt.getTime() !== group.contributedAt.getTime()
    ) {
      throw new Error('MIGRATION_ATTRIBUTION_CONFLICT');
    }
    await this.migrations.map(trackId, group.legacyTrackIds);
    return { trackId, initialProcessingId: initial.processingId };
  }
}
