import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AlbumsRepository } from './albums.repository.js';
import { AlbumsLegacyMapService } from './albums-legacy-map.service.js';

/** Database-only Album identity access for the operator; no Processing workers. */
@Module({
  imports: [DatabaseModule],
  providers: [AlbumsRepository, AlbumsLegacyMapService],
  exports: [AlbumsLegacyMapService],
})
export class AlbumsLegacyMapModule {}
