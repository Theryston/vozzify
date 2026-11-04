import { Module } from '@nestjs/common';
import { LegacyCutoverRepository } from './legacy-cutover.repository.js';
import { LegacyCutoverReportService } from './legacy-cutover-report.service.js';
import { LegacyImportModule } from './legacy-import.module.js';

@Module({
  imports: [LegacyImportModule],
  providers: [LegacyCutoverRepository, LegacyCutoverReportService],
  exports: [LegacyCutoverReportService],
})
export class LegacyCutoverReportModule {}
