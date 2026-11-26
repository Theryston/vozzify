'use client';

import dynamic from 'next/dynamic';

import { usePathname } from '@/lib/i18n/navigation';

import { useLocationSearch } from '../use-location-search';
import { MenuSkeleton } from './menu-skeleton';
import { SessionUserBoundary } from './session-user';
import { SignedOutActions } from './signed-out-actions';

// Loaded after the page (Base UI menu and drawer are heavy), and only for
// signed-in users.
const UserMenu = dynamic(
  () => import('./user-menu').then((module) => module.UserMenu),
  { ssr: false, loading: MenuSkeleton },
);

/**
 * The account corner of the site header: sign in/up for visitors, the avatar
 * menu for signed-in users. The session is read in the browser, so the page
 * around it stays static.
 */
export function AccountMenu() {
  const pathname = usePathname();
  const search = useLocationSearch();
  // Where sign in/up come back to, and where signing out stays.
  const currentPath = `${pathname}${search}`;

  return (
    <SessionUserBoundary
      render={(user, loading) => {
        if (loading) return <MenuSkeleton />;
        if (!user) return <SignedOutActions currentPath={currentPath} />;
        return <UserMenu user={user} currentPath={currentPath} />;
      }}
    />
  );
}
