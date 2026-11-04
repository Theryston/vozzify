import { Module } from '@nestjs/common';
import { LegacyProcessingAdmissionModule } from '../legacy-import/legacy-processing-admission.module.js';
import { TrackMigrationService } from './track-migration.service.js';
import { trackModuleImports, trackServiceProviders } from './tracks.module.js';

/** Operators enqueue work; only the running API consumes Processing jobs. */
@Module({
  imports: [...trackModuleImports, LegacyProcessingAdmissionModule],
  providers: trackServiceProviders,
  exports: [TrackMigrationService],
})
export class TrackMigrationModule {}
