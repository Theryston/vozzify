import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { TracksSearchRepository } from './tracks-search.repository.js';
import { TracksSearchService } from './tracks-search.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [TracksSearchRepository, TracksSearchService],
  exports: [TracksSearchService],
})
export class TracksSearchModule {}
