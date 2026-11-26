import type { ReactNode } from 'react';
import { UserIdentityMarks } from '@/features/auth/components/user-identity-marks';

import type { SessionUser } from '../session';
import { UserAvatar } from './user-avatar';

/** The signed-in user once they have chosen a username. */
export type ProfileUser = Omit<SessionUser, 'username'> & { username: string };

/**
 * The Avatar (or initials) with the picker beside it. `previewUrl` stands in
 * for the Avatar while a new picture waits to be saved.
 */
export function ProfileAvatar({
  user,
  previewUrl,
  children,
}: {
  user: ProfileUser;
  previewUrl?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
      <UserAvatar
        size="full"
        user={{ ...user, image: previewUrl ?? user.image }}
        className="size-24 *:data-[slot=avatar-fallback]:text-2xl sm:size-20"
      />
      <UserIdentityMarks identity={user.avatarIdentity} recordLabel />
      {children}
    </div>
  );
}
