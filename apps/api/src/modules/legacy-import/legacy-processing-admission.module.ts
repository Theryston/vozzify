import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { LegacyProcessingAdmissionService } from './legacy-processing-admission.service.js';
import { LegacyProcessingBacklogRepository } from './legacy-processing-backlog.repository.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    LegacyProcessingBacklogRepository,
    LegacyProcessingAdmissionService,
  ],
  exports: [
    LegacyProcessingAdmissionService,
    LegacyProcessingBacklogRepository,
  ],
})
export class LegacyProcessingAdmissionModule {}
