import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { LegacyFavoriteImportModule } from '../favorites/legacy-favorite-import.module.js';
import { LegacyTrackViewImportModule } from '../tracks/legacy-track-view-import.module.js';
import { LegacyImportRepository } from './legacy-import.repository.js';
import { LegacyRelationshipDomainService } from './legacy-relationship-domain.service.js';
import { LegacyRelationshipImportRepository } from './legacy-relationship-import.repository.js';
import { LegacyRelationshipImportService } from './legacy-relationship-import.service.js';
import { LegacySourceModule } from './legacy-source.module.js';

/** Relationship migration context with revalidation but no Processing workers. */
@Module({
  imports: [
    ConfigModule,
    LegacySourceModule,
    DatabaseModule,
    LegacyFavoriteImportModule,
    LegacyTrackViewImportModule,
  ],
  providers: [
    LegacyImportRepository,
    LegacyRelationshipImportRepository,
    LegacyRelationshipImportService,
    LegacyRelationshipDomainService,
  ],
  exports: [LegacyRelationshipImportService],
})
export class LegacyRelationshipImportModule {}
