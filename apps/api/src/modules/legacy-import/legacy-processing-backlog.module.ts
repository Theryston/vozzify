import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { QueueModule } from '../../queue/queue.module.js';
import { RedisModule } from '../../redis/redis.module.js';
import { TrackMigrationModule } from '../tracks/track-migration.module.js';
import { LegacyProcessingAdmissionModule } from './legacy-processing-admission.module.js';
import { LegacyProcessingBacklogService } from './legacy-processing-backlog.service.js';

/** The operator enqueues work; existing API workers consume it. */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    TrackMigrationModule,
    LegacyProcessingAdmissionModule,
  ],
  providers: [LegacyProcessingBacklogService],
  exports: [LegacyProcessingBacklogService],
})
export class LegacyProcessingBacklogModule {}
