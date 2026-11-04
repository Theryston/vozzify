import { Injectable } from '@nestjs/common';
import { cacheTags, LOCALES, type Locale } from '@vozzify/contracts';
import { WebRevalidationService } from '../../integrations/web-revalidation/web-revalidation.service.js';
import { PersonalHomeQueueService } from '../home/home-personal-queue.service.js';
import type { LegacyFavorite } from '../legacy-import/legacy-relationships.js';
import { LegacyTrackMapService } from '../tracks/legacy-track-map.service.js';
import { LegacyFavoriteImportRepository } from './legacy-favorite-import.repository.js';

@Injectable()
export class LegacyFavoriteImportService {
  constructor(
    private readonly maps: LegacyTrackMapService,
    private readonly favorites: LegacyFavoriteImportRepository,
    private readonly personalRefresh: PersonalHomeQueueService,
    private readonly revalidation: WebRevalidationService,
  ) {}

  async importPage(favorites: LegacyFavorite[]) {
    const resolutions = await this.maps.resolve(
      favorites.map((favorite) => favorite.trackId),
    );
    assertResolvable(
      favorites.map((favorite) => favorite.trackId),
      resolutions,
    );
    const result = await this.favorites.importPage(favorites, resolutions);
    return result;
  }

  async refreshPage(favorites: LegacyFavorite[]): Promise<void> {
    const resolutions = await this.maps.resolve(
      favorites.map((favorite) => favorite.trackId),
    );
    const userIds = new Set(
      favorites.flatMap((favorite) =>
        resolutions.get(favorite.trackId)?.kind === 'mapped'
          ? [favorite.userId]
          : [],
      ),
    );
    await Promise.all(
      [...userIds].flatMap((userId) =>
        LOCALES.map((locale: Locale) =>
          this.personalRefresh.scheduleRefresh(userId, locale),
        ),
      ),
    );
    await this.revalidateProfiles([...userIds]);
  }

  private async revalidateProfiles(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const usernames = await this.favorites.usernamesFor(userIds);
    for (const username of usernames) {
      await this.revalidation.revalidate([cacheTags.userFavorites(username)]);
    }
  }
}

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
