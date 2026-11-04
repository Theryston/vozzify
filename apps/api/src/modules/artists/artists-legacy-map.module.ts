import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { ArtistsRepository } from './artists.repository.js';
import { ArtistsLegacyMapService } from './artists-legacy-map.service.js';

/** Database-only Artist identity access for the operator; no Processing workers. */
@Module({
  imports: [DatabaseModule],
  providers: [ArtistsRepository, ArtistsLegacyMapService],
  exports: [ArtistsLegacyMapService],
})
export class ArtistsLegacyMapModule {}
