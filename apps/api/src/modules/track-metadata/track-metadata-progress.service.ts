import { Injectable } from '@nestjs/common';
import {
  TrackMetadataProgressRepository,
  type TrackMetadataProgressStatus,
} from './track-metadata-progress.repository.js';

/** Worker-free status access shared by metadata jobs and the legacy operator. */
@Injectable()
export class TrackMetadataProgressService {
  constructor(private readonly repository: TrackMetadataProgressRepository) {}

  markTrack(trackId: string, status: TrackMetadataProgressStatus) {
    return this.repository.markTrack(trackId, status);
  }

  async findStatuses(trackIds: string[]) {
    const rows = await this.repository.findStatuses(trackIds);
    return new Map(
      rows.map((row) => [row.trackId, normalizeStatus(row.status)]),
    );
  }
}

const normalizeStatus = (value: string): TrackMetadataProgressStatus =>
  value === 'completed' || value === 'failed' ? value : 'pending';
