import { Global, Module } from '@nestjs/common';
import { ENV, loadLegacyImportEnv } from '../../config/env.js';
import { DatabaseModule } from '../../database/database.module.js';
import { LegacyImportRepository } from './legacy-import.repository.js';
import { LegacyImportService } from './legacy-import.service.js';
import { LegacyPersonalImportService } from './legacy-personal-import.service.js';
import {
  LEGACY_IMPORT_ENV,
  LegacySourceRepository,
} from './legacy-source.repository.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: loadLegacyImportEnv }],
  exports: [ENV],
})
class LegacyImportConfigModule {}

// Operator-only: no HTTP routes, workers, OAuth calls or public role changes.
@Module({
  imports: [LegacyImportConfigModule, DatabaseModule],
  providers: [
    LegacyImportRepository,
    { provide: LEGACY_IMPORT_ENV, useExisting: ENV },
    LegacySourceRepository,
    LegacyImportService,
    LegacyPersonalImportService,
  ],
  exports: [
    LegacyImportService,
    LegacyPersonalImportService,
    LegacyImportRepository,
    LegacySourceRepository,
  ],
})
export class LegacyImportModule {}
