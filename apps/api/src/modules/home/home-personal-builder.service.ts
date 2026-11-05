import { Inject, Injectable, Optional } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { HomeRow, Locale } from '@vozzify/contracts';
import { AttemptsService } from '../attempts/attempts.service.js';
import { StreaksService } from '../streaks/streaks.service.js';
import { UsersService } from '../users/users.service.js';
import type { StoredPersonalHomeFeed } from './home-feed.js';
import { HomeFeedService } from './home-feed.service.js';
import { isMasteredTrack, personalLambda } from './home-personal.js';
import {
  PersonalHomeRepository,
  type UserTrackSignal,
} from './home-personal.repository.js';
import type { UserTasteActivity } from './home-personal.repository.types.js';
import { tasteSignalsOf } from './home-personal-activity.js';
import { dailyTargetRow } from './home-personal-daily-target.js';
import {
  blendedDiscoveryPool,
  buildPersonalDiscoveryRows,
} from './home-personal-discovery.js';
import {
  decayedSignalCount,
  decayedTaste,
  type TasteSignal,
} from './home-personal-recommendations.js';
import { resumeRows, trackIdsOfRow } from './home-personal-resume-rows.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';
import { personalHomeVersion } from './home-personal-version.js';
import {
  buildPersonalVoiceRows,
  personalTrackPool,
  personalVoiceRowTrackIds,
} from './home-personal-voice.js';
import { DEFAULT_HOME_LOCALE, HOME_ALGORITHM_VERSION } from './home-rules.js';
import { HomeSocialService } from './home-social.service.js';

/**
 * Builds one User's personal feed. The public feed is the base: its Tracks
 * are re-ranked by the blend of their normalized popularity with the User's
 * taste, mastered Tracks are filtered out of the discovery rows, and the
 * resume rows and the daily target strip lead. A User with no data gets the
 * public rows (λ = 0 keeps their order) plus the strip.
 */
@Injectable()
export class PersonalHomeBuilder {
  @Optional()
  @Inject(AttemptsService)
  private readonly attempts?: AttemptsService;

  @Inject(PersonalHomeTasteRowsService)
  private readonly tasteRows: PersonalHomeTasteRowsService | undefined;

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
    const [{ feed }, signals, favorites, settings, userRange] =
      await Promise.all([
        this.feeds.currentPublic(locale),
        this.personal.findUserTrackSignals(userId),
        this.personal.findUserFavoriteSignals(userId),
        this.users.getPracticeSettings(userId),
        this.attempts?.vocalRange(userId) ?? Promise.resolve(null),
      ]);
    const activities =
      await this.requireTasteRows().findUserTasteActivities(userId);
    const socialRows = await (this.social?.rowsFor(userId) ??
      Promise.resolve([]));
    const rows = await this.buildRows({
      userId,
      publicRows: feed.rows,
      signals,
      favorites,
      activities,
      socialRows,
      timeZone: settings.timeZone,
      userRange,
    });
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
      generatedAt: new Date().toISOString(),
    });
  }

  private async buildRows(options: {
    userId: string;
    publicRows: HomeRow[];
    signals: UserTrackSignal[];
    favorites: Awaited<
      ReturnType<PersonalHomeRepository['findUserFavoriteSignals']>
    >;
    activities: UserTasteActivity[];
    socialRows: HomeRow[];
    timeZone: string | null;
    userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
  }): Promise<HomeRow[]> {
    const {
      userId,
      publicRows,
      signals,
      favorites,
      activities,
      socialRows,
      timeZone,
      userRange,
    } = options;
    const tasteSignals = tasteSignalsOf(activities, favorites);
    const taste = decayedTaste(tasteSignals);
    const signalCount = decayedSignalCount(tasteSignals);
    const lambda = personalLambda(signalCount);
    const mastered = new Set(
      signals
        .filter((signal) => isMasteredTrack(signal.bestAccuracy))
        .map((signal) => signal.trackId),
    );
    const leadingRows: HomeRow[] = [
      ...resumeRows(signals, mastered),
      await dailyTargetRow(this.streaks, userId, timeZone),
      ...socialRows,
    ];
    return [
      ...leadingRows,
      ...(await this.recommendationRows({
        userId,
        publicRows,
        signals,
        tasteSignals,
        taste,
        lambda,
        mastered,
        leadingRows,
        userRange,
      })),
    ];
  }

  private async recommendationRows(options: {
    userId: string;
    publicRows: HomeRow[];
    signals: UserTrackSignal[];
    tasteSignals: TasteSignal[];
    taste: ReturnType<typeof decayedTaste>;
    lambda: number;
    mastered: ReadonlySet<string>;
    leadingRows: HomeRow[];
    userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
  }): Promise<HomeRow[]> {
    const {
      userId,
      publicRows,
      signals,
      tasteSignals,
      taste,
      lambda,
      mastered,
      leadingRows,
      userRange,
    } = options;
    const usedTrackIds = new Set(leadingRows.flatMap(trackIdsOfRow));
    const tasteRows = await this.requireTasteRows().build({
      userId,
      signals,
      tasteSignals,
      taste,
      mastered,
      usedTrackIds,
      publicRows,
    });
    const discovery = await this.findDiscoveryTracks(publicRows);
    const blended = blendedDiscoveryPool({
      publicRows,
      discovery,
      taste,
      lambda,
      masteredTrackIds: mastered,
      userRange,
    });
    const { voiceRows, discoveryRows } = this.buildVoiceAndDiscoveryRows({
      publicRows,
      discovery,
      blended,
      mastered,
      userRange,
      usedTrackIds,
    });
    for (const row of discoveryRows) {
      for (const id of trackIdsOfRow(row)) usedTrackIds.add(id);
    }
    const exploration = await this.explorationRow({
      taste,
      tasteSignals,
      mastered,
      usedTrackIds,
      rows: [...leadingRows, ...tasteRows, ...voiceRows, ...discoveryRows],
    });
    return [
      ...tasteRows,
      ...voiceRows,
      ...(exploration ? [exploration] : []),
      ...discoveryRows,
    ];
  }

  private async findDiscoveryTracks(publicRows: HomeRow[]) {
    const pool = personalTrackPool(publicRows);
    return this.personal.findDiscoveryTracks([
      ...new Set(pool.map((track) => track.id)),
    ]);
  }

  private explorationRow(options: {
    taste: ReturnType<typeof decayedTaste>;
    tasteSignals: TasteSignal[];
    mastered: ReadonlySet<string>;
    usedTrackIds: ReadonlySet<string>;
    rows: HomeRow[];
  }) {
    return this.requireTasteRows().explorationRow({
      taste: options.taste,
      tasteSignals: options.tasteSignals,
      mastered: options.mastered,
      usedTrackIds: options.usedTrackIds,
      visibleTrackSlots: options.rows.flatMap(trackIdsOfRow).length,
    });
  }

  private buildVoiceAndDiscoveryRows(options: {
    publicRows: HomeRow[];
    discovery: Awaited<
      ReturnType<PersonalHomeRepository['findDiscoveryTracks']>
    >;
    blended: ReturnType<typeof blendedDiscoveryPool>;
    mastered: ReadonlySet<string>;
    userRange: Awaited<ReturnType<AttemptsService['vocalRange']>>;
    usedTrackIds: Set<string>;
  }): { voiceRows: HomeRow[]; discoveryRows: HomeRow[] } {
    const {
      publicRows,
      discovery,
      blended,
      mastered,
      userRange,
      usedTrackIds,
    } = options;
    const voiceRows = userRange
      ? buildPersonalVoiceRows({
          rows: publicRows,
          userRange,
          discovery,
          masteredTrackIds: mastered,
          alreadyUsedTrackIds: usedTrackIds,
        })
      : [];
    for (const id of personalVoiceRowTrackIds(voiceRows)) {
      usedTrackIds.add(id);
    }
    const discoveryRows = buildPersonalDiscoveryRows({
      publicRows,
      sorted: blended,
      masteredTrackIds: mastered,
      alreadyUsedTrackIds: usedTrackIds,
    });
    return { voiceRows, discoveryRows };
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

  private requireTasteRows(): PersonalHomeTasteRowsService {
    if (!this.tasteRows) {
      throw new Error('Home taste rows are not configured');
    }
    return this.tasteRows;
  }
}
