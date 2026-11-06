import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { WebRevalidationModule } from '../../integrations/web-revalidation/web-revalidation.module.js';
import { AttemptsModule } from '../attempts/attempts.module.js';
import { AttemptsProfileModule } from '../attempts/attempts-profile.module.js';
import { EditorialPinsModule } from '../editorial-pins/editorial-pins.module.js';
import { StreaksModule } from '../streaks/streaks.module.js';
import { TrackLocaleTrendingService } from '../tracks/track-locale-trending.service.js';
import { TracksModule } from '../tracks/tracks.module.js';
import { UsersModule } from '../users/users.module.js';
import { HomeController } from './home.controller.js';
import { HomeRepository } from './home.repository.js';
import { HomeService } from './home.service.js';
import { HomeAdminController } from './home-admin.controller.js';
import { HOME_FEED_QUEUE } from './home-feed.job.js';
import { HomeFeedProcessor } from './home-feed.processor.js';
import { HomeFeedService } from './home-feed.service.js';
import { HomeFeedStore } from './home-feed.store.js';
import { HomeFeedBuilder } from './home-feed-builder.service.js';
import { PersonalHomeProcessor } from './home-personal.processor.js';
import { PersonalHomeRepository } from './home-personal.repository.js';
import { PersonalHomeStore } from './home-personal.store.js';
import { PersonalHomeBuilder } from './home-personal-builder.service.js';
import { PersonalHomeQueueModule } from './home-personal-queue.module.js';
import { PersonalHomeTasteRepository } from './home-personal-taste.repository.js';
import { PersonalHomeTasteRowsService } from './home-personal-taste-rows.service.js';
import { HomePinOverlayService } from './home-pin-overlay.service.js';
import { HomePopularityRepository } from './home-popularity.repository.js';
import {
  createHomeEntityRowSources,
  createHomeRowSources,
  HOME_ENTITY_ROW_SOURCES,
  HOME_ROW_SOURCES,
} from './home-row-sources.js';
import { HomeSocialRepository } from './home-social.repository.js';
import { HomeSocialService } from './home-social.service.js';
import { HomeSocialStore } from './home-social.store.js';
import { HomeVisitService } from './home-visit.service.js';
import { HomeVisitStore } from './home-visit.store.js';
import { createVoiceRowSources } from './home-voice-row-sources.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: HOME_FEED_QUEUE }),
    AttemptsModule,
    PersonalHomeQueueModule,
    TracksModule,
    UsersModule,
    StreaksModule,
    WebRevalidationModule,
    EditorialPinsModule,
    AttemptsProfileModule,
  ],
  controllers: [HomeController, HomeAdminController],
  providers: [
    HomePopularityRepository,
    HomeRepository,
    {
      provide: HOME_ROW_SOURCES,
      inject: [HomeRepository, TrackLocaleTrendingService],
      useFactory: (
        repository: HomeRepository,
        ranking: TrackLocaleTrendingService,
      ) => [
        ...createHomeRowSources(repository, ranking),
        ...createVoiceRowSources(repository),
      ],
    },
    {
      provide: HOME_ENTITY_ROW_SOURCES,
      inject: [HomeRepository, TrackLocaleTrendingService],
      useFactory: createHomeEntityRowSources,
    },
    HomeFeedBuilder,
    HomeFeedStore,
    HomeVisitStore,
    HomeVisitService,
    HomeFeedService,
    HomeService,
    HomePinOverlayService,
    HomeFeedProcessor,
    PersonalHomeRepository,
    HomeSocialRepository,
    HomeSocialService,
    HomeSocialStore,
    PersonalHomeStore,
    PersonalHomeBuilder,
    PersonalHomeTasteRowsService,
    PersonalHomeTasteRepository,
    PersonalHomeProcessor,
  ],
})
export class HomeModule {}
