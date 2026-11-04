import { Module } from '@nestjs/common';
import { MusicCatalogModule } from '../../integrations/music-catalog/music-catalog.module.js';
import { WebRevalidationModule } from '../../integrations/web-revalidation/web-revalidation.module.js';
import { AlbumsModule } from '../albums/albums.module.js';
import { ArtistsModule } from '../artists/artists.module.js';
import { TracksModule } from '../tracks/tracks.module.js';
import { TrackMetadataProcessor } from './track-metadata.processor.js';
import { TrackMetadataService } from './track-metadata.service.js';
import { TrackMetadataImportService } from './track-metadata-import.service.js';
import { TrackMetadataProgressModule } from './track-metadata-progress.module.js';

/**
 * The metadata import of requested Tracks (ADR 0005). It consumes the metadata
 * queue, which the tracks module fills, and writes Artists and Albums through
 * their modules. Nothing imports this module, so its imports cannot form a cycle.
 */
@Module({
  imports: [
    TrackMetadataProgressModule,
    AlbumsModule,
    ArtistsModule,
    MusicCatalogModule,
    TracksModule,
    WebRevalidationModule,
  ],
  providers: [
    TrackMetadataImportService,
    TrackMetadataService,
    TrackMetadataProcessor,
  ],
})
export class TrackMetadataModule {}
