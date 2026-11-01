import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { SonicModule } from '../../integrations/sonic/sonic.module.js';
import { TracksSearchModule } from '../tracks/tracks-search.module.js';
import { SearchIndexService } from './search-index.service.js';

@Module({
  imports: [ConfigModule, SonicModule, TracksSearchModule],
  providers: [SearchIndexService],
  exports: [SearchIndexService],
})
export class SearchIndexModule {}
