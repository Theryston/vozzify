import { Inject, Injectable, Optional } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Locale } from '@vozzify/contracts';
import { AttemptsService } from '../attempts/attempts.service.js';
import { StreaksService } from '../streaks/streaks.service.js';
import { TrackLocaleTrendingService } from '../tracks/track-locale-trending.service.js';
import { UsersService } from '../users/users.service.js';
import { HomeRepository } from './home.repository.js';
import type { StoredPersonalHomeFeed } from './home-feed.js';
import { HomeFeedService } from './home-feed.service.js';
import { isGenreRow } from './home-genre-rows.js';
import { PersonalHomeRepository } from './home-personal.repository.js';
import { buildPersonalRows } from './home-personal-builder-rows.js';
import { requirePersonalTasteRows } from './home-personal-composition.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';
import { personalHomeVersion } from './home-personal-version.js';
import { DEFAULT_HOME_LOCALE, HOME_ALGORITHM_VERSION } from './home-rules.js';
import { HomeSocialService } from './home-social.service.js';

/** Builds one User's feed from public rows and private practice signals. */
@Injectable()
export class PersonalHomeBuilder {
  @Optional()
  @Inject(AttemptsService)
  private readonly attempts?: AttemptsService;

  @Inject(PersonalHomeTasteRowsService)
  private readonly tasteRows: PersonalHomeTasteRowsService | undefined;

  @Inject(HomeRepository)
  private readonly homeRepository: HomeRepository;

  @Inject(TrackLocaleTrendingService)
  private readonly localeTrending: TrackLocaleTrendingService;

  @Optional()
  @Inject(HomeSocialService)
  private readonly social?: HomeSocialService;

  constructor(
    private readonly feeds: HomeFeedService,
    private readonly personal: PersonalHomeRepository,
    private readonly streaks: StreaksService,
    private readonly users: UsersService,
  ) {}

  async build(
    userId: string,
    locale: Locale = DEFAULT_HOME_LOCALE,
  ): Promise<StoredPersonalHomeFeed> {
    const [
      { feed },
      signals,
      favorites,
      settings,
      userRange,
      voiceEvidenceCount,
    ] = await Promise.all([
      this.feeds.currentPublic(locale),
      this.personal.findUserTrackSignals(userId),
      this.personal.findUserFavoriteSignals(userId),
      this.users.getPracticeSettings(userId),
      this.attempts?.vocalRange(userId) ?? Promise.resolve(null),
      this.attempts?.vocalRangeEvidenceCount(userId) ?? Promise.resolve(null),
    ]);
    const activities = await requirePersonalTasteRows(
      this.tasteRows,
    ).findUserTasteActivities(userId);
    const socialRows = (await this.social?.rowsFor(userId)) ?? [];
    const { rows, compositionCandidates } = await buildPersonalRows(
      {
        personal: this.personal,
        streaks: this.streaks,
        homeRepository: this.homeRepository,
        localeTrending: this.localeTrending,
        tasteRows: this.tasteRows,
      },
      {
        userId,
        locale,
        publicRows: feed.rows.filter((row) => !isGenreRow(row)),
        albumCandidates: feed.albumCandidates,
        compositionCandidates: feed.compositionCandidates,
        signals,
        favorites,
        activities,
        socialRows,
        timeZone: settings.timeZone,
        userRange,
        voiceEvidenceCount,
      },
    );
    return this.linkArtistPages({
      audience: 'personal',
      locale,
      version: personalHomeVersion(
        userId,
        locale,
        HOME_ALGORITHM_VERSION,
        rows,
      ),
      algorithmVersion: HOME_ALGORITHM_VERSION,
      rows,
      compositionCandidates,
      generatedAt: new Date().toISOString(),
    });
  }

  @Transactional()
  async refreshCommunityCooccurrence(): Promise<void> {
    await this.personal.refreshCommunityCooccurrence();
  }

  private async linkArtistPages(
    feed: StoredPersonalHomeFeed,
  ): Promise<StoredPersonalHomeFeed> {
    if (!this.feeds.withArtistLinks) return feed;
    return { ...feed, rows: await this.feeds.withArtistLinks(feed.rows) };
  }
}
