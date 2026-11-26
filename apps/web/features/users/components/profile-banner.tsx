import type { PublicProfile } from '@vozzify/contracts';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  entityBannerClass,
  entityBannerRowClass,
  entityTitleClass,
  entityVisualClass,
} from '@/components/entity-header';
import { UserAvatar } from '@/features/auth/components/user-avatar';
import { UserIdentityMarks } from '@/features/auth/components/user-identity-marks';
import { ProfileChips } from '@/features/users/components/profile-chips';

import { followCountsOf } from '../follow-state';
import { ProfileFollow, ProfileFollowAction } from './profile-follow';
import { ProfileOwnerActions } from './profile-owner-actions';
import { ProfileShare } from './profile-share';

/**
 * The Profile banner, a featured block (DESIGN.md "Featured blocks"): the
 * Avatar, or the initials on the orange surface, sits on the right; the Name
 * in display type with the `@username`, "member since" and the follow counts
 * on the left; the action row under them holds the follow, share and owner
 * buttons.
 */
export async function ProfileBanner({ profile }: { profile: PublicProfile }) {
  const [t, format] = await Promise.all([
    getTranslations('publicProfile'),
    getFormatter(),
  ]);
  const memberSince = format.dateTime(new Date(profile.createdAt), {
    year: 'numeric',
    month: 'long',
  });

  return (
    <div className="flex flex-col gap-2">
      <section aria-labelledby="profile-name" className={entityBannerClass}>
        <div className={entityBannerRowClass}>
          <UserAvatar
            user={profile}
            size="full"
            className={`${entityVisualClass} *:data-[slot=avatar-fallback]:bg-primary-foreground *:data-[slot=avatar-fallback]:text-2xl *:data-[slot=avatar-fallback]:text-primary md:*:data-[slot=avatar-fallback]:text-3xl`}
          />
          <div className="flex min-w-0 flex-col gap-3 sm:flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
              <h1 id="profile-name" className={entityTitleClass}>
                {profile.name}
              </h1>
              <UserIdentityMarks
                identity={profile.avatarIdentity}
                recordLabel
              />
              <p className="font-semibold text-lg leading-none opacity-80 md:text-xl">
                @{profile.username}
              </p>
            </div>
            <ProfileFollow
              username={profile.username}
              counts={followCountsOf(profile)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <ProfileFollowAction username={profile.username} />
              <ProfileShare name={profile.name} username={profile.username} />
              <ProfileOwnerActions username={profile.username} />
            </div>
            <ProfileChips profile={profile} />
          </div>
        </div>
      </section>
      <p className="px-2 text-muted-foreground text-xs">
        {t('banner.memberSince', { date: memberSince })}
      </p>
    </div>
  );
}
