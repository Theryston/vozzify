import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmailModule } from '../../integrations/email/email.module.js';
import { PrivateTracksModule } from '../private-tracks/private-tracks.module.js';
import { UsersModule } from '../users/users.module.js';
import { STREAK_REMINDER_QUEUE } from './streak-reminder.job.js';
import { StreakReminderProcessor } from './streak-reminder.processor.js';
import { StreakReminderRepository } from './streak-reminder.repository.js';
import { StreakReminderService } from './streak-reminder.service.js';
import { StreaksController } from './streaks.controller.js';
import { StreaksRepository } from './streaks.repository.js';
import { StreaksService } from './streaks.service.js';

/** The daily practice streak of a User. */
@Module({
  imports: [
    UsersModule,
    PrivateTracksModule,
    EmailModule,
    BullModule.registerQueue({ name: STREAK_REMINDER_QUEUE }),
  ],
  controllers: [StreaksController],
  exports: [StreaksService],
  providers: [
    StreaksService,
    StreaksRepository,
    StreakReminderProcessor,
    StreakReminderService,
    StreakReminderRepository,
  ],
})
export class StreaksModule {}
