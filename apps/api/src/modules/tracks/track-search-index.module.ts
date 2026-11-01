import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { SonicModule } from '../../integrations/sonic/sonic.module.js';
import { TrackSearchIndexService } from './track-search-index.service.js';
import { TrackSearchIndexEventRepository } from './track-search-index-event.repository.js';

@Module({
  imports: [ConfigModule, DatabaseModule, SonicModule],
  providers: [TrackSearchIndexEventRepository, TrackSearchIndexService],
  exports: [TrackSearchIndexEventRepository, TrackSearchIndexService],
})
export class TrackSearchIndexModule {}
