import { Module } from '@nestjs/common';
import { MusicCatalogModule } from '../../integrations/music-catalog/music-catalog.module.js';
import { LegacyImportModule } from './legacy-import.module.js';
import { LegacyRecordingPlanRepository } from './legacy-recording-plan.repository.js';
import { LegacyRecordingPlanService } from './legacy-recording-plan.service.js';

@Module({
  imports: [LegacyImportModule, MusicCatalogModule],
  providers: [LegacyRecordingPlanRepository, LegacyRecordingPlanService],
  exports: [LegacyRecordingPlanService],
})
export class LegacyRecordingPlanModule {}
