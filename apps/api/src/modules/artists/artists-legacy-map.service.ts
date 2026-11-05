import { Injectable } from '@nestjs/common';
import { ArtistsRepository } from './artists.repository.js';

/** Internal API for the legacy catalog-map operator; it does not load workers. */
@Injectable()
export class ArtistsLegacyMapService {
  constructor(private readonly repository: ArtistsRepository) {}

  findEvidence(trackIds: string[]) {
    return this.repository.findLegacyMapEvidence(trackIds);
  }

  findIdByMbid(mbid: string) {
    return this.repository.findArtistIdByMbid(mbid);
  }

  map(legacyId: string, artistId: string) {
    return this.repository.mapLegacyArtistId(legacyId, artistId);
  }
}
