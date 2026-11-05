import { Injectable } from '@nestjs/common';
import type { LegacyView } from '../legacy-import/legacy-relationships.js';
import type { LegacyTrackResolution } from './legacy-track-map.repository.js';
import { LegacyTrackMapService } from './legacy-track-map.service.js';
import { LegacyTrackViewImportRepository } from './legacy-track-view-import.repository.js';
import { TrackTrendingService } from './track-trending.service.js';

@Injectable()
export class LegacyTrackViewImportService {
  constructor(
    private readonly maps: LegacyTrackMapService,
    private readonly views: LegacyTrackViewImportRepository,
    private readonly trending: TrackTrendingService,
  ) {}

  async importPage(views: LegacyView[]) {
    const resolutions = await this.maps.resolve(
      views.map((view) => view.trackId),
    );
    assertResolvable(
      views.map((view) => view.trackId),
      resolutions,
    );
    return this.views.importPage(views, mappedTrackIds(resolutions));
  }

  async refreshPage(views: LegacyView[]): Promise<void> {
    const resolutions = await this.maps.resolve(
      views.map((view) => view.trackId),
    );
    assertResolvable(
      views.map((view) => view.trackId),
      resolutions,
    );
    const trackIds = new Set(
      [...resolutions.values()].flatMap((resolution) =>
        resolution.kind === 'mapped' ? [resolution.trackId] : [],
      ),
    );
    for (const trackId of trackIds) await this.trending.refresh(trackId);
  }
}

const mappedTrackIds = (
  resolutions: Map<string, LegacyTrackResolution>,
): Map<string, string> =>
  new Map(
    [...resolutions].flatMap(([legacyId, resolution]) =>
      resolution.kind === 'mapped' ? [[legacyId, resolution.trackId]] : [],
    ),
  );

const assertResolvable = (
  legacyTrackIds: string[],
  resolutions: Map<string, { kind: string }>,
): void => {
  for (const id of legacyTrackIds) {
    const resolution = resolutions.get(id);
    if (!resolution || resolution.kind === 'unknown')
      throw new Error('RELATIONSHIP_PLAN_MISSING');
    if (resolution.kind === 'pending')
      throw new Error('RELATIONSHIP_MAP_PENDING');
  }
};
