import { Injectable, Logger } from '@nestjs/common';
import { SonicService } from '../../integrations/sonic/sonic.service.js';
import {
  type SearchIndexTrack,
  TracksSearchService,
} from '../tracks/tracks-search.service.js';

const INDEX_PAGE_SIZE = 200;

/** Rebuilds the searchable projection from the API's completed Tracks. */
@Injectable()
export class SearchIndexService {
  private readonly logger = new Logger(SearchIndexService.name);
  constructor(
    private readonly tracks: TracksSearchService,
    private readonly sonic: SonicService,
  ) {}

  async rebuild(): Promise<void> {
    await this.sonic.markIndexNotReady();
    let afterId: string | undefined;
    for (;;) {
      const page = await this.tracks.findSearchIndexPage(
        afterId,
        INDEX_PAGE_SIZE,
      );
      if (page.length === 0) break;
      for (const track of page) {
        await this.sonic.indexTrack(track.id, searchableText(track));
      }
      afterId = page.at(-1)?.id;
      this.logger.log(
        `Indexed ${page.length} eligible Tracks through ${afterId}`,
      );
    }
    await this.sonic.markIndexReady();
  }
}

const searchableText = (track: SearchIndexTrack): string =>
  `${track.title} ${track.artistCredit
    .map(({ name, joinPhrase }) => `${name}${joinPhrase}`)
    .join('')}`;
