import { Injectable } from '@nestjs/common';
import { LegacyTrackMapRepository } from './legacy-track-map.repository.js';

@Injectable()
export class LegacyTrackMapService {
  constructor(private readonly maps: LegacyTrackMapRepository) {}

  resolve(legacyTrackIds: string[]) {
    return this.maps.resolve(legacyTrackIds);
  }
}
