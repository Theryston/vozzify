import { Injectable } from '@nestjs/common';
import { LegacyFavoriteImportService } from '../favorites/legacy-favorite-import.service.js';
import { LegacyTrackViewImportService } from '../tracks/legacy-track-view-import.service.js';
import type { LegacyFavorite, LegacyView } from './legacy-relationships.js';

@Injectable()
export class LegacyRelationshipDomainService {
  constructor(
    private readonly favorites: LegacyFavoriteImportService,
    private readonly views: LegacyTrackViewImportService,
  ) {}

  importFavorites(page: LegacyFavorite[]) {
    return this.favorites.importPage(page);
  }

  refreshFavorites(page: LegacyFavorite[]): Promise<void> {
    return this.favorites.refreshPage(page);
  }

  importViews(page: LegacyView[]) {
    return this.views.importPage(page);
  }

  refreshViews(page: LegacyView[]): Promise<void> {
    return this.views.refreshPage(page);
  }
}
