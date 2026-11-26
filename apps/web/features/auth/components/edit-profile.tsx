'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentUser } from '@vozzify/contracts';
import { useEffect } from 'react';
import { SubscriptionNavigation } from '@/features/plans/components/subscription-navigation';
import { useRouter } from '@/lib/i18n/navigation';
import type { StoredDailyTarget } from '../current-user-query';
import { currentUserQueryOptions } from '../current-user-query';
import { authKeys } from '../query-keys';
import { authHref } from '../redirect-to';
import { type SessionUser, sessionUserOptions } from '../session';
import { sessionAvatarIdentity } from './avatar-status';
import { EditProfileForm } from './edit-profile-form';
import { EditProfileSkeleton } from './edit-profile-skeleton';

const EDIT_PROFILE_PATH = '/me/edit';

/**
 * The edit form for the signed-in user, read from the session in the browser
 * (so the page stays static). Signed-out visitors go to sign in and come
 * back; a user missing the username or a verified email keeps the skeleton
 * while `AuthGate` sends them to that step.
 */
export function EditProfile() {
  const { data: user } = useQuery(sessionUserOptions());
  const queryClient = useQueryClient();
  const router = useRouter();
  // The stored profile: the source of truth for the Daily target, so a
  // choice made on another device (or since sign-in) pre-fills correctly.
  const { data: currentUser, isPending: currentUserPending } = useQuery({
    ...currentUserQueryOptions(),
    enabled: Boolean(user?.username && user.emailVerified),
  });

  useEffect(() => {
    // `null` is the answer "nobody is signed in"; `undefined` is still
    // loading (or failed), which must not look like being signed out.
    if (user === null) {
      router.replace(authHref('/sign-in', EDIT_PROFILE_PATH));
    }
  }, [user, router]);

  if (!user?.username || !user.emailVerified) return <EditProfileSkeleton />;
  // A failed read pre-fills the fallback target instead of hiding the form.
  if (currentUserPending) return <EditProfileSkeleton />;

  const showSaved = (saved: CurrentUser) => {
    // The header reads the same session, so it shows the saved Name at once.
    queryClient.setQueryData<SessionUser | null>(
      authKeys.session(),
      (current) =>
        current
          ? { ...current, name: saved.name, image: saved.image ?? undefined }
          : current,
    );
    // The save answered the updated profile, so pre-filling it next time
    // needs no refetch. Today's streak status reads the new target at once:
    // every streak query hangs off the 'streak' root key (see
    // features/streaks/query-keys), matched here by predicate because a
    // feature never imports another feature's queries.
    queryClient.setQueryData<StoredDailyTarget>(authKeys.currentUser(), {
      dailyPracticeTargetSeconds: saved.dailyPracticeTargetSeconds ?? null,
    });
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === 'streak',
    });
  };

  const profileUser = { ...user, username: user.username };
  const form = (subscribed?: boolean) => (
    <EditProfileForm
      user={{
        ...profileUser,
        avatarIdentity: sessionAvatarIdentity(user, subscribed),
      }}
      dailyTargetSeconds={currentUser?.dailyPracticeTargetSeconds ?? null}
      onSaved={showSaved}
    />
  );
  return user.id ? (
    <SubscriptionNavigation userId={user.id} render={form} />
  ) : (
    form()
  );
}
