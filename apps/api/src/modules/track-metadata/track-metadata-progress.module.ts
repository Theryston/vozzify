import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { TrackMetadataProgressRepository } from './track-metadata-progress.repository.js';
import { TrackMetadataProgressService } from './track-metadata-progress.service.js';

/** Worker-free durable progress access for metadata jobs and import operators. */
@Module({
  imports: [DatabaseModule],
  providers: [TrackMetadataProgressRepository, TrackMetadataProgressService],
  exports: [TrackMetadataProgressService],
})
export class TrackMetadataProgressModule {}
