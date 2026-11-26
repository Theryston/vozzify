'use client';

import {
  FileTextIcon,
  LayersIcon,
  LogOutIcon,
  type LucideIcon,
  Music2Icon,
  PencilIcon,
  UserIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  MenuDrawer,
  MenuDrawerList,
  menuDrawerItemClassName,
} from '@/components/menu-drawer';
import {
  menuItemClassName,
  menuSurfaceClassName,
} from '@/components/menu-styles';
import {
  PreferencesPanel,
  PreferencesSubmenus,
} from '@/components/preferences';
import { Button } from '@/components/ui/button';
import { DrawerClose } from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SubscriptionNavigation } from '@/features/plans/components/subscription-navigation';
import { usePrivateTracksMenu } from '@/features/private-tracks/components/private-tracks-menu';
import { Link } from '@/lib/i18n/navigation';

import type { SessionUser } from '../session';
import { useSignOut } from './sign-out';
import { UserAvatar } from './user-avatar';

type MenuLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  onClick?: () => void;
};

function MenuLinkLabel({ label, badge }: Pick<MenuLink, 'label' | 'badge'>) {
  return (
    <>
      {label}
      {badge && (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary text-xs">
          {badge}
        </span>
      )}
    </>
  );
}

function useMenuLinks(
  user: SessionUser,
  subscribed: boolean | undefined,
  openLibrary: () => void,
): MenuLink[] {
  const t = useTranslations('header');
  const profile: MenuLink[] = user.username
    ? [
        {
          href: `/users/${user.username}`,
          label: t('account.myProfile'),
          icon: UserIcon,
        },
      ]
    : [];
  return [
    ...profile,
    {
      href: '/me/tracks',
      label: t('account.myTracks'),
      icon: Music2Icon,
      badge: subscribed === false ? t('account.proBadge') : undefined,
      onClick: openLibrary,
    },
    { href: '/me/edit', label: t('account.editProfile'), icon: PencilIcon },
    {
      href: subscribed ? '/subscription' : '/plans',
      label: t(subscribed ? 'account.subscription' : 'account.plans'),
      icon: LayersIcon,
    },
  ];
}

function UserSummary({ user }: { user: SessionUser }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-2">
      <UserAvatar user={user} />
      <div className="min-w-0">
        <p className="truncate font-semibold text-sm">
          {user.name || user.username}
        </p>
        {user.username ? (
          <p className="truncate text-muted-foreground text-xs">
            @{user.username}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type Props = { user: SessionUser; currentPath: string };
type MenuProps = Props & { subscribed: boolean | undefined };
type MenuItemsProps = Props & { links: MenuLink[] };

/** The signed-in user's menu: a dropdown from `md` up. */
function UserDropdown({ user, currentPath, links }: MenuItemsProps) {
  const t = useTranslations('header');
  const { signOut, pending } = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('account.accountMenu')}
          />
        }
      >
        <UserAvatar user={user} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className={menuSurfaceClassName}
      >
        <UserSummary user={user} />
        <DropdownMenuSeparator />
        {links.map(({ href, label, badge, onClick, icon: Icon }) => (
          <DropdownMenuItem
            key={href}
            className={menuItemClassName}
            render={onClick ? undefined : <Link href={href} />}
            onClick={onClick}
          >
            <Icon />
            <MenuLinkLabel label={label} badge={badge} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <PreferencesSubmenus />
        <DropdownMenuItem
          className={menuItemClassName}
          render={<Link href="/terms" />}
        >
          <FileTextIcon />
          {t('preferences.terms')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={menuItemClassName}
          disabled={pending}
          onClick={() => signOut(currentPath)}
        >
          <LogOutIcon />
          {t('account.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same menu as a bottom sheet, below `md`. */
function UserDrawer({ user, currentPath, links }: MenuItemsProps) {
  const t = useTranslations('header');
  const { signOut, pending } = useSignOut();

  return (
    <MenuDrawer
      title={t('account.accountMenu')}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('account.accountMenu')}
        >
          <UserAvatar user={user} />
        </Button>
      }
    >
      <UserSummary user={user} />
      <MenuDrawerList>
        {links.map(({ href, label, badge, onClick, icon: Icon }) => (
          <li key={href}>
            <DrawerClose
              nativeButton={Boolean(onClick)}
              role={onClick ? undefined : 'link'}
              render={onClick ? undefined : <Link href={href} />}
              onClick={onClick}
              className={menuDrawerItemClassName()}
            >
              <Icon />
              <MenuLinkLabel label={label} badge={badge} />
            </DrawerClose>
          </li>
        ))}
      </MenuDrawerList>
      <PreferencesPanel />
      <MenuDrawerList>
        <li>
          <Link href="/terms" className={menuDrawerItemClassName()}>
            <FileTextIcon />
            {t('preferences.terms')}
          </Link>
        </li>
        <li>
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => signOut(currentPath)}
            className={menuDrawerItemClassName()}
          >
            <LogOutIcon />
            {t('account.signOut')}
          </button>
        </li>
      </MenuDrawerList>
    </MenuDrawer>
  );
}

// The wrappers are flex so the 40px avatar button centers in the header row
// instead of sitting on its top edge. The 2px right margin brings the avatar's
// visible right inset level with the top and bottom ones.
const avatarSlotClassName = 'mr-0.5 items-center';

/** Avatar button opening the signed-in user's menu. */
export function UserMenu(props: Props) {
  return props.user.id ? (
    <SubscriptionNavigation
      userId={props.user.id}
      render={(subscribed) => (
        <UserMenuContent
          key={JSON.stringify([props.user.id, props.currentPath])}
          {...props}
          subscribed={subscribed}
        />
      )}
    />
  ) : (
    <UserMenuContent {...props} subscribed={undefined} />
  );
}

function UserMenuContent({ user, currentPath, subscribed }: MenuProps) {
  const { openLibrary, feedback } = usePrivateTracksMenu();
  const links = useMenuLinks(user, subscribed, openLibrary);
  return (
    <>
      <div className={`hidden md:flex ${avatarSlotClassName}`}>
        <UserDropdown user={user} currentPath={currentPath} links={links} />
      </div>
      <div className={`flex md:hidden ${avatarSlotClassName}`}>
        <UserDrawer user={user} currentPath={currentPath} links={links} />
      </div>
      {feedback}
    </>
  );
}
