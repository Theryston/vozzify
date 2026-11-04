import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { LegacyTrackMapRepository } from './legacy-track-map.repository.js';
import { LegacyTrackMapService } from './legacy-track-map.service.js';

/** Read-only bridge from old Track IDs to their prepared destination Tracks. */
@Module({
  imports: [DatabaseModule],
  providers: [LegacyTrackMapRepository, LegacyTrackMapService],
  exports: [LegacyTrackMapService],
})
export class LegacyTrackMapModule {}
