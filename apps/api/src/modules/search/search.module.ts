import { Module } from '@nestjs/common';
import { MusicCatalogModule } from '../../integrations/music-catalog/music-catalog.module.js';
import { SonicModule } from '../../integrations/sonic/sonic.module.js';
import { TracksModule } from '../tracks/tracks.module.js';
import { TracksSearchModule } from '../tracks/tracks-search.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [MusicCatalogModule, SonicModule, TracksModule, TracksSearchModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
