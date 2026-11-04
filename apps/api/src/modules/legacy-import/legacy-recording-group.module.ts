import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { QueueModule } from '../../queue/queue.module.js';
import { RedisModule } from '../../redis/redis.module.js';
import { TrackMigrationModule } from '../tracks/track-migration.module.js';
import { LegacyRecordingGroupRepository } from './legacy-recording-group.repository.js';
import { LegacyRecordingGroupService } from './legacy-recording-group.service.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    TrackMigrationModule,
  ],
  providers: [LegacyRecordingGroupRepository, LegacyRecordingGroupService],
  exports: [LegacyRecordingGroupService],
})
export class LegacyRecordingGroupModule {}
