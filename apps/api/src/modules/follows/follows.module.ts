import { Module } from '@nestjs/common';
import { WebRevalidationModule } from '../../integrations/web-revalidation/web-revalidation.module.js';
import { UsersModule } from '../users/users.module.js';
import { FollowListsController } from './follow-lists.controller.js';
import { FollowListsRepository } from './follow-lists.repository.js';
import { FollowListsService } from './follow-lists.service.js';
import { FollowWritesService } from './follow-writes.service.js';
import { FollowsController } from './follows.controller.js';
import { FollowsRepository } from './follows.repository.js';
import { FollowsService } from './follows.service.js';
import { ProfileFollowController } from './profile-follow.controller.js';

/** Who follows whom: the follow writes, the counts and lists of a Profile. */
@Module({
  imports: [UsersModule, WebRevalidationModule],
  controllers: [
    FollowsController,
    ProfileFollowController,
    FollowListsController,
  ],
  providers: [
    FollowsService,
    FollowWritesService,
    FollowsRepository,
    FollowListsService,
    FollowListsRepository,
  ],
  exports: [FollowsService],
})
export class FollowsModule {}
