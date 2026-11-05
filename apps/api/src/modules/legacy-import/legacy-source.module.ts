import { Module } from '@nestjs/common';
import { loadLegacyImportEnv } from '../../config/env.js';
import {
  LEGACY_IMPORT_ENV,
  LegacySourceRepository,
} from './legacy-source.repository.js';

/** Read-only frozen source access without replacing the API environment token. */
@Module({
  providers: [
    { provide: LEGACY_IMPORT_ENV, useFactory: loadLegacyImportEnv },
    LegacySourceRepository,
  ],
  exports: [LegacySourceRepository],
})
export class LegacySourceModule {}
