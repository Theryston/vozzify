import { Injectable } from '@nestjs/common';
import type {
  MusicCatalogSearchParams,
  SearchResult,
} from '@vozzify/contracts';
import { MusicCatalogClient } from '../../integrations/music-catalog/music-catalog.client.js';

@Injectable()
export class SearchService {
  constructor(private readonly catalog: MusicCatalogClient) {}

  /**
   * The catalog owns the Track association projection and relevance order.
   */
  async search(params: MusicCatalogSearchParams): Promise<SearchResult> {
    const result = await this.catalog.search(params);
    return { ...result, source: 'music-catalog' };
  }
}
