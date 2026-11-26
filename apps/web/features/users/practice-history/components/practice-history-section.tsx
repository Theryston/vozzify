import type { PracticeAttemptHistoryPage } from '@vozzify/contracts';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';

import { Skeleton } from '@/components/ui/skeleton';
import { getSectionVisibilityLabels } from '@/features/users/section-visibility-labels';
import { viewerOwnsProfile } from '@/features/users/viewer-owns-profile';

import {
  ProfileSectionScope,
  SectionVisibilityToggle,
} from '../../components/profile-section-scope';
import {
  getOwnPracticeHistoryFirstPage,
  getPracticeHistoryFirstPage,
} from '../practice-history-first-page';
import { PracticeHistoryList } from './practice-history-list';
import { PracticeHistoryRowSkeletons } from './practice-history-row-skeletons';

/**
 * The practice history section of a Profile. Its first page is read on each
 * request (inside a Suspense boundary in the page), and the list it hydrates
 * into reads the rest in the browser. The list's strings come from the
 * `profileHistory` block, the only namespace this client tree receives. A
 * section the owner hid is left out for visitors and shown dimmed to the owner.
 */
export async function PracticeHistorySection({
  username,
}: {
  username: string;
}) {
  const [visitorPage, owner] = await Promise.all([
    getPracticeHistoryFirstPage(username),
    viewerOwnsProfile(username),
  ]);
  if (visitorPage === null && !owner) return null;
  const initialPage = owner
    ? await getOwnPracticeHistoryFirstPage(username)
    : visitorPage;
  // An empty history is absent, as an empty favorites grid is: the owner is
  // invited to fill it below the sections instead.
  if (initialPage === null || initialPage?.items.length === 0) {
    return null;
  }

  return (
    <PracticeHistoryBody
      username={username}
      initialPage={initialPage}
      hiddenForVisitors={visitorPage === null}
      owner={owner}
    />
  );
}

async function PracticeHistoryBody({
  username,
  initialPage,
  hiddenForVisitors,
  owner,
}: {
  username: string;
  // `undefined` when the API could not answer: the list then reads in the browser.
  initialPage: PracticeAttemptHistoryPage | undefined;
  hiddenForVisitors: boolean;
  owner: boolean;
}) {
  const [t, { profileHistory }, labels] = await Promise.all([
    getTranslations('profileHistory'),
    getMessages(),
    getSectionVisibilityLabels(),
  ]);

  return (
    <ProfileSectionScope
      username={username}
      section="practiceHistory"
      hiddenForVisitors={hiddenForVisitors}
      labels={labels}
    >
      <section
        aria-labelledby="profile-history-title"
        className="flex flex-col gap-4"
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="profile-history-title" className="font-bold text-xl">
            {t('title')}
          </h2>
          <SectionVisibilityToggle />
        </header>
        <NextIntlClientProvider messages={{ profileHistory }}>
          <PracticeHistoryList
            username={username}
            initialPage={initialPage}
            owner={owner}
          />
        </NextIntlClientProvider>
      </section>
    </ProfileSectionScope>
  );
}

/**
 * Before the server has the first page, the section has no runs to size its
 * stand-ins from, so it shows five plain rows. The first page's real height
 * replaces them when it arrives; that is the one shift this section allows.
 */
const FALLBACK_ROWS = ['1', '2', '3', '4', '5'].map((id) => ({
  id,
  bleedSuspected: false,
}));

/** The section's stand-in while its first page loads: the title and the rows. */
export async function PracticeHistorySkeleton() {
  const t = await getTranslations('profileHistory');
  return (
    <div
      role="status"
      aria-label={t('loading')}
      className="flex flex-col gap-4"
    >
      <Skeleton className="h-7 w-48 rounded-md" />
      <PracticeHistoryRowSkeletons rows={FALLBACK_ROWS} />
    </div>
  );
}
