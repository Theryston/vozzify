import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';

import type { FollowCounts } from '../follow-state';
import { ProfileFollowButton } from './profile-follow-button';
import { ProfileFollowControls } from './profile-follow-controls';

/**
 * The follow counts under the Profile banner. Its strings come from the
 * `publicProfile.follow` and `publicProfile.followList` blocks and `errors`
 * (for a failed follow), the only namespaces this client tree receives.
 */
export async function ProfileFollow({
  username,
  counts,
}: {
  username: string;
  counts: FollowCounts;
}) {
  return (
    <FollowMessages>
      <ProfileFollowControls username={username} counts={counts} />
    </FollowMessages>
  );
}

/** The follow button, for the banner's action row. */
export async function ProfileFollowAction({ username }: { username: string }) {
  return (
    <FollowMessages>
      <ProfileFollowButton username={username} />
    </FollowMessages>
  );
}

async function FollowMessages({ children }: { children: ReactNode }) {
  const { avatarIdentity, publicProfile, errors } = await getMessages();
  return (
    <NextIntlClientProvider
      messages={{
        avatarIdentity,
        publicProfile: {
          follow: publicProfile.follow,
          followList: publicProfile.followList,
        },
        errors,
      }}
    >
      {children}
    </NextIntlClientProvider>
  );
}
