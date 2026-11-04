import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { WebRevalidationModule } from '../../integrations/web-revalidation/web-revalidation.module.js';
import { QueueModule } from '../../queue/queue.module.js';
import { LegacyTrackMapModule } from './legacy-track-map.module.js';
import { LegacyTrackViewImportRepository } from './legacy-track-view-import.repository.js';
import { LegacyTrackViewImportService } from './legacy-track-view-import.service.js';
import { TrackTrendingService } from './track-trending.service.js';
import { TrackViewRepository } from './track-view.repository.js';
import { TracksRepository } from './tracks.repository.js';

/** Operator-only view writes and score refreshes, without Processing workers. */
@Module({
  imports: [
    DatabaseModule,
    LegacyTrackMapModule,
    QueueModule,
    WebRevalidationModule,
  ],
  providers: [
    LegacyTrackViewImportRepository,
    LegacyTrackViewImportService,
    TrackTrendingService,
    TrackViewRepository,
    TracksRepository,
  ],
  exports: [LegacyTrackViewImportService],
})
export class LegacyTrackViewImportModule {}
