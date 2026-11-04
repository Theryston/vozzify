import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { WebRevalidationModule } from '../../integrations/web-revalidation/web-revalidation.module.js';
import { QueueModule } from '../../queue/queue.module.js';
import { PersonalHomeQueueModule } from '../home/home-personal-queue.module.js';
import { LegacyTrackMapModule } from '../tracks/legacy-track-map.module.js';
import { LegacyFavoriteImportRepository } from './legacy-favorite-import.repository.js';
import { LegacyFavoriteImportService } from './legacy-favorite-import.service.js';

/** Operator-only favorite writes and refreshes, without importing TracksModule. */
@Module({
  imports: [
    DatabaseModule,
    LegacyTrackMapModule,
    QueueModule,
    WebRevalidationModule,
    PersonalHomeQueueModule,
  ],
  providers: [LegacyFavoriteImportRepository, LegacyFavoriteImportService],
  exports: [LegacyFavoriteImportService],
})
export class LegacyFavoriteImportModule {}
