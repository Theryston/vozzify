import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { invitedSections } from '@/features/users/owner-invitations';
import {
  getOwnPracticeHistoryFirstPage,
  getPracticeHistoryFirstPage,
} from '@/features/users/practice-history/practice-history-first-page';
import { getPublicFavoritesPage } from '@/features/users/queries';
import { viewerOwnsProfile } from '@/features/users/viewer-owns-profile';

import { OwnerInvitations } from './owner-invitations';

/**
 * The owner's invitations for empty Profile sections. They sit
 * after every section, so an invitation that appears once the session loads
 * moves nothing above it. A section hidden from visitors or unreadable is
 * never invited here.
 */
export async function ProfileOwnerInvitations({
  username,
}: {
  username: string;
}) {
  const [favorites, history, owner] = await Promise.all([
    getPublicFavoritesPage(username).catch((error: unknown) => {
      // Logged, so an outage is visible, as the favorites section does.
      console.error(`Favorite songs of ${username} could not be read`, error);
      return undefined;
    }),
    getPracticeHistoryFirstPage(username),
    viewerOwnsProfile(username),
  ]);
  const ownerHistory =
    owner && history?.items.length === 0
      ? await getOwnPracticeHistoryFirstPage(username)
      : history;
  const sections = invitedSections({
    favorites: favorites ? favorites.items.length === 0 : undefined,
    practiceHistory: ownerHistory ? ownerHistory.items.length === 0 : undefined,
  });
  if (sections.length === 0) {
    return null;
  }
  const { profileOwner } = await getMessages();
  return (
    <NextIntlClientProvider messages={{ profileOwner }}>
      <OwnerInvitations username={username} sections={sections} />
    </NextIntlClientProvider>
  );
}
