import { Module } from '@nestjs/common';
import { TrackMigrationService } from './track-migration.service.js';
import { trackModuleImports, trackServiceProviders } from './tracks.module.js';

/** Operators enqueue work; only the running API consumes Processing jobs. */
@Module({
  imports: trackModuleImports,
  providers: trackServiceProviders,
  exports: [TrackMigrationService],
})
export class TrackMigrationModule {}
