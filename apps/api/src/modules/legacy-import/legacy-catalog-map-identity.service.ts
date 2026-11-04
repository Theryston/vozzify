import { Injectable } from '@nestjs/common';
import { AlbumsLegacyMapService } from '../albums/albums-legacy-map.service.js';
import { ArtistsLegacyMapService } from '../artists/artists-legacy-map.service.js';

/** Keeps map writes and metadata evidence behind the owning catalog modules. */
@Injectable()
export class LegacyCatalogMapIdentityService {
  constructor(
    private readonly artists: ArtistsLegacyMapService,
    private readonly albums: AlbumsLegacyMapService,
  ) {}

  findArtistEvidence(trackIds: string[]) {
    return this.artists.findEvidence(trackIds);
  }

  findAlbumEvidence(trackIds: string[]) {
    return this.albums.findEvidence(trackIds);
  }

  findArtistId(mbid: string) {
    return this.artists.findIdByMbid(mbid);
  }

  mapArtist(legacyId: string, artistId: string) {
    return this.artists.map(legacyId, artistId);
  }

  findAlbumId(mbid: string) {
    return this.albums.findIdByMbid(mbid);
  }

  mapAlbum(legacyId: string, albumId: string) {
    return this.albums.map(legacyId, albumId);
  }
}
