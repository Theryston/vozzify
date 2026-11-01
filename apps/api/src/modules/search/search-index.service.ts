import { Injectable, Logger } from '@nestjs/common';
import { SonicService } from '../../integrations/sonic/sonic.service.js';
import { TrackSearchIndexService } from '../tracks/track-search-index.service.js';
import { TracksSearchService } from '../tracks/tracks-search.service.js';

const INDEX_PAGE_SIZE = 200;

/** Rebuilds the searchable projection from the API's completed Tracks. */
@Injectable()
export class SearchIndexService {
  private readonly logger = new Logger(SearchIndexService.name);
  constructor(
    private readonly tracks: TracksSearchService,
    private readonly sonic: SonicService,
    private readonly delivery: TrackSearchIndexService,
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
      await this.delivery.enqueueBackfillPage(page);
      await this.drainDueEvents();
      afterId = page.at(-1)?.id;
      this.logger.log(
        `Indexed ${page.length} eligible Tracks through ${afterId}`,
      );
    }
    await this.drainDueEvents();
    await this.sonic.markIndexReady();
  }

  private async drainDueEvents(): Promise<void> {
    while ((await this.delivery.countPending()) > 0) {
      if ((await this.delivery.dispatchPending()) === 0) {
        throw new Error('Sonic index rebuild has undelivered events');
      }
    }
  }
}
