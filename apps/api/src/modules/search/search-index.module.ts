import { Module } from '@nestjs/common';
import { SonicModule } from '../../integrations/sonic/sonic.module.js';
import { TrackSearchIndexModule } from '../tracks/track-search-index.module.js';
import { TracksSearchModule } from '../tracks/tracks-search.module.js';
import { SearchIndexService } from './search-index.service.js';

@Module({
  imports: [SonicModule, TracksSearchModule, TrackSearchIndexModule],
  providers: [SearchIndexService],
  exports: [SearchIndexService],
})
export class SearchIndexModule {}
