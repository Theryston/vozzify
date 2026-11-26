import { Module } from '@nestjs/common';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { WebRevalidationModule } from '../../integrations/web-revalidation/web-revalidation.module.js';
import { SubscriptionMembershipModule } from '../plans/subscription-membership.module.js';
import { AcquisitionRepository } from './acquisition.repository.js';
import { AcquisitionService } from './acquisition.service.js';
import { ProfileVisibilityRepository } from './profile-visibility.repository.js';
import { ProfileVisibilityService } from './profile-visibility.service.js';
import { UserAvatarIdentityService } from './user-avatar-identity.service.js';
import { UserProfileService } from './user-profile.service.js';
import { UserSitemapController } from './user-sitemap.controller.js';
import { UserSitemapRepository } from './user-sitemap.repository.js';
import { UserSitemapService } from './user-sitemap.service.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

// The public Profile route lives in ProfilesModule: it also needs the
// attempts, and the attempts module depends on tracks, which depend on users.
@Module({
  imports: [SubscriptionMembershipModule, StorageModule, WebRevalidationModule],
  controllers: [UsersController, UserSitemapController],
  providers: [
    UsersService,
    UsersRepository,
    AcquisitionRepository,
    AcquisitionService,
    UserSitemapService,
    UserSitemapRepository,
    UserProfileService,
    UserAvatarIdentityService,
    ProfileVisibilityRepository,
    ProfileVisibilityService,
  ],
  exports: [
    UsersService,
    UserProfileService,
    ProfileVisibilityService,
    UserAvatarIdentityService,
  ],
})
export class UsersModule {}
