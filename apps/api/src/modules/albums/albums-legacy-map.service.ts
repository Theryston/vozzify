import { Injectable } from '@nestjs/common';
import { AlbumsRepository } from './albums.repository.js';

/** Internal API for the legacy catalog-map operator; it does not load workers. */
@Injectable()
export class AlbumsLegacyMapService {
  constructor(private readonly repository: AlbumsRepository) {}

  findEvidence(trackIds: string[]) {
    return this.repository.findLegacyMapEvidence(trackIds);
  }

  findIdByMbid(mbid: string) {
    return this.repository.findAlbumIdByMbid(mbid);
  }

  map(legacyId: string, albumId: string) {
    return this.repository.mapLegacyAlbumId(legacyId, albumId);
  }
}
