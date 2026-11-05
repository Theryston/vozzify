import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ENV, loadLegacyCatalogMapEnv } from '../../config/env.js';
import { DatabaseModule } from '../../database/database.module.js';
import { QueueModule } from '../../queue/queue.module.js';
import { TRACK_METADATA_QUEUE } from '../../queue/track-metadata.job.js';
import { AlbumsLegacyMapModule } from '../albums/albums-legacy-map.module.js';
import { ArtistsLegacyMapModule } from '../artists/artists-legacy-map.module.js';
import { TrackMetadataProgressModule } from '../track-metadata/track-metadata-progress.module.js';
import { LegacyCatalogMapRepository } from './legacy-catalog-map.repository.js';
import { LegacyCatalogMapService } from './legacy-catalog-map.service.js';
import { LegacyCatalogMapIdentityService } from './legacy-catalog-map-identity.service.js';
import { LegacyCatalogMapInputService } from './legacy-catalog-map-input.service.js';
import { LegacyCatalogMapReconciler } from './legacy-catalog-map-reconciler.js';
import { LegacySourceModule } from './legacy-source.module.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: loadLegacyCatalogMapEnv }],
  exports: [ENV],
})
class LegacyCatalogMapConfigModule {}

/** Operator context reads metadata queue state without starting any workers. */
@Module({
  imports: [
    LegacyCatalogMapConfigModule,
    DatabaseModule,
    QueueModule,
    BullModule.registerQueue({ name: TRACK_METADATA_QUEUE }),
    ArtistsLegacyMapModule,
    AlbumsLegacyMapModule,
    TrackMetadataProgressModule,
    LegacySourceModule,
  ],
  providers: [
    LegacyCatalogMapRepository,
    LegacyCatalogMapIdentityService,
    LegacyCatalogMapInputService,
    LegacyCatalogMapReconciler,
    LegacyCatalogMapService,
  ],
  exports: [LegacyCatalogMapService],
})
export class LegacyCatalogMapModule {}
