import { Injectable } from '@nestjs/common';
import { mbidSchema, type SearchResultItem } from '@vozzify/contracts';
import { TracksSearchRepository } from './tracks-search.repository.js';

export type SearchIndexTrack = {
  id: string;
  title: string;
  artistCredit: { name: string; joinPhrase: string }[];
  updatedAt: Date;
};

@Injectable()
export class TracksSearchService {
  constructor(private readonly repository: TracksSearchRepository) {}

  async findSearchResults(
    trackIds: readonly string[],
  ): Promise<SearchResultItem[]> {
    const found = await this.repository.findByIds(trackIds);
    const byId = new Map(found.map((track) => [track.id, track]));
    return trackIds.flatMap((trackId) => {
      const track = byId.get(trackId);
      return track === undefined
        ? []
        : [
            {
              mbid: mbidSchema.parse(track.recordingMbid),
              title: track.title,
              artistCredit: track.artistCredit
                .map(({ name, joinPhrase }) => `${name}${joinPhrase}`)
                .join(''),
              coverUrl: track.coverUrl,
              trackId: track.id,
            },
          ];
    });
  }

  findSearchIndexPage(
    afterId: string | undefined,
    limit: number,
  ): Promise<SearchIndexTrack[]> {
    return this.repository.findIndexPage(afterId, limit);
  }
}
