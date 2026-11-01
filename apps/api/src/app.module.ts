import { Module } from '@nestjs/common';
import { RateLimitModule } from './common/rate-limit/rate-limit.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { MusicCatalogModule } from './integrations/music-catalog/music-catalog.module.js';
import { StorageModule } from './integrations/storage/storage.module.js';
import { WebRevalidationModule } from './integrations/web-revalidation/web-revalidation.module.js';
import { AlbumsModule } from './modules/albums/albums.module.js';
import { ArtistsModule } from './modules/artists/artists.module.js';
import { AttemptsModule } from './modules/attempts/attempts.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { FavoritesModule } from './modules/favorites/favorites.module.js';
import { FollowsModule } from './modules/follows/follows.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { HomeModule } from './modules/home/home.module.js';
import { PlansModule } from './modules/plans/plans.module.js';
import { PracticePreferencesModule } from './modules/practice-preferences/practice-preferences.module.js';
import { ProfileSummaryModule } from './modules/profile-summary/profile-summary.module.js';
import { ProfilesModule } from './modules/profiles/profiles.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { SearchIndexModule } from './modules/search/search-index.module.js';
import { StreaksModule } from './modules/streaks/streaks.module.js';
import { TrackMetadataModule } from './modules/track-metadata/track-metadata.module.js';
import { TracksModule } from './modules/tracks/tracks.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    RateLimitModule,
    // After RateLimitModule: global guards run in registration order, so
    // the throttler rejects floods before any session lookup.
    AuthModule,
    EventsModule,
    WebRevalidationModule,
    StorageModule,
    MusicCatalogModule,
    HealthModule,
    HomeModule,
    PlansModule,
    AlbumsModule,
    ArtistsModule,
    SearchModule,
    SearchIndexModule,
    TracksModule,
    TrackMetadataModule,
    FavoritesModule,
    FollowsModule,
    StreaksModule,
    AttemptsModule,
    PracticePreferencesModule,
    ProfileSummaryModule,
    UsersModule,
    ProfilesModule,
  ],
})
export class AppModule {}
