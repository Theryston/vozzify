import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { CoverArtModule } from '../../integrations/cover-art/cover-art.module.js';
import { MusicCatalogModule } from '../../integrations/music-catalog/music-catalog.module.js';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { WebRevalidationModule } from '../../integrations/web-revalidation/web-revalidation.module.js';
import { QueueModule } from '../../queue/queue.module.js';
import { TrackCoverService } from './track-cover.service.js';
import { TrackCoverRepairRepository } from './track-cover-repair.repository.js';
import { TrackCoverRepairService } from './track-cover-repair.service.js';
import { TracksRepository } from './tracks.repository.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MusicCatalogModule,
    CoverArtModule,
    StorageModule,
    QueueModule,
    WebRevalidationModule,
  ],
  providers: [
    TracksRepository,
    TrackCoverService,
    TrackCoverRepairRepository,
    TrackCoverRepairService,
  ],
  exports: [TrackCoverRepairService],
})
export class TrackCoverRepairModule {}
