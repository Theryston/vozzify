import { Module } from '@nestjs/common';
import { PersonalHomeQueueModule } from '../home/home-personal-queue.module.js';
import { PrivateTracksModule } from '../private-tracks/private-tracks.module.js';
import { TracksModule } from '../tracks/tracks.module.js';
import { UsersModule } from '../users/users.module.js';
import { AttemptsRepository } from './attempts.repository.js';
import { AttemptsService } from './attempts.service.js';
import { AttemptsProfileModule } from './attempts-profile.module.js';
import { MyAttemptsController } from './my-attempts.controller.js';
import { PrivateAttemptsController } from './private-attempts.controller.js';
import { PrivateAttemptsService } from './private-attempts.service.js';
import { SubmitAttemptService } from './submit-attempt.service.js';
import { TrackAttemptsController } from './track-attempts.controller.js';
import { UserAttemptsController } from './user-attempts.controller.js';
import { UserAttemptsService } from './user-attempts.service.js';

/** A signed-in User's saved practice runs and their own history. */
@Module({
  imports: [
    TracksModule,
    UsersModule,
    PersonalHomeQueueModule,
    PrivateTracksModule,
    AttemptsProfileModule,
  ],
  controllers: [
    TrackAttemptsController,
    MyAttemptsController,
    PrivateAttemptsController,
    UserAttemptsController,
  ],
  providers: [
    AttemptsService,
    AttemptsRepository,
    SubmitAttemptService,
    PrivateAttemptsService,
    UserAttemptsService,
  ],
  exports: [AttemptsService],
})
export class AttemptsModule {}
