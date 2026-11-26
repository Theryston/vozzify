'use client';

import type { FollowListUser } from '@vozzify/contracts';
import { useTranslations } from 'next-intl';
import { type RefObject, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/features/auth/components/user-avatar';
import { UserIdentityMarks } from '@/features/auth/components/user-identity-marks';
import { Link } from '@/lib/i18n/navigation';

import {
  type FollowListRowAction,
  followListRowAction,
} from '../follow-list-actions';
import type { FollowListSide } from '../follow-list-query';
import { useFollowList } from '../hooks/use-follow-list';
import { useFollowListAction } from '../hooks/use-follow-list-action';

const EMPTY_KEY = {
  followers: 'emptyFollowers',
  following: 'emptyFollowing',
  friends: 'emptyFriends',
} as const;

const AVATAR_CLASS = 'size-12';
const ROW_CLASS =
  'flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl pl-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * A Profile's followers, following or friends in a dialog: rows that link to
 * each User's Profile, with infinite scroll. The Profile's own User also gets
 * a button on each row (see `followListRowAction`). Mounted only while it is
 * open, so each opening starts its list from the first page (or the cache).
 */
export function FollowListDialog({
  username,
  side,
  open,
  viewerIsOwner,
  onOpenChange,
}: {
  username: string;
  side: FollowListSide;
  open: boolean;
  viewerIsOwner: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('publicProfile.followList');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t('close')}
        className="max-h-[80dvh] overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>{t(side)}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {open ? (
            <FollowListBody
              username={username}
              side={side}
              viewerIsOwner={viewerIsOwner}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FollowListBody({
  username,
  side,
  viewerIsOwner,
}: {
  username: string;
  side: FollowListSide;
  viewerIsOwner: boolean;
}) {
  const t = useTranslations('publicProfile.followList');
  const list = useRef<HTMLUListElement>(null);
  const sentinel = useRef<HTMLLIElement>(null);
  const result = useFollowList(username, side);
  useLoadNextOnScroll(result, list, sentinel);

  if (result.error) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <p role="alert" className="text-muted-foreground text-sm">
          {t('loadError')}
        </p>
        <button
          type="button"
          onClick={() => void result.refetch()}
          className="h-10 rounded-full bg-secondary px-4 font-semibold text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  if (result.isPending) {
    return (
      <p
        role="status"
        className="py-6 text-center text-muted-foreground text-sm"
      >
        {t('loading')}
      </p>
    );
  }

  const items = result.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-muted-foreground text-sm">
        {t(EMPTY_KEY[side])}
      </p>
    );
  }

  return (
    <>
      <FollowListRows
        username={username}
        side={side}
        viewerIsOwner={viewerIsOwner}
        items={items}
        list={list}
        sentinel={sentinel}
        hasNextPage={result.hasNextPage}
      />
      {result.isFetchingNextPage ? (
        <p role="status" className="text-center text-muted-foreground text-sm">
          {t('loadingMore')}
        </p>
      ) : null}
    </>
  );
}

/** The rows of a loaded list, and the action each one offers the viewer. */
function FollowListRows({
  username,
  side,
  viewerIsOwner,
  items,
  list,
  sentinel,
  hasNextPage,
}: {
  username: string;
  side: FollowListSide;
  viewerIsOwner: boolean;
  items: FollowListUser[];
  list: RefObject<HTMLUListElement | null>;
  sentinel: RefObject<HTMLLIElement | null>;
  hasNextPage: boolean;
}) {
  const action = followListRowAction(side, viewerIsOwner);
  const change = useFollowListAction(username, side);
  return (
    <ul
      ref={list}
      className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
    >
      {items.map((user) => (
        <FollowListRow
          key={user.id}
          user={user}
          action={action}
          pending={change.isPending && change.variables?.userId === user.id}
          onAction={(chosen) =>
            change.mutate({ userId: user.id, action: chosen })
          }
        />
      ))}
      {hasNextPage ? (
        <li ref={sentinel} aria-hidden="true" className="h-px shrink-0" />
      ) : null}
    </ul>
  );
}

/**
 * Fetches the next page when the sentinel after the last row scrolls into the
 * list's visible area, so the list grows as the user reaches its end.
 */
function useLoadNextOnScroll(
  result: ReturnType<typeof useFollowList>,
  list: RefObject<HTMLUListElement | null>,
  sentinel: RefObject<HTMLLIElement | null>,
) {
  const { error, fetchNextPage, hasNextPage, isFetchingNextPage } = result;
  useEffect(() => {
    const target = sentinel.current;
    const root = list.current;
    if (error || target === null || root === null || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { root, rootMargin: '100px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [error, fetchNextPage, hasNextPage, isFetchingNextPage, list, sentinel]);
}

/**
 * One listed User: Avatar, name and handle, linking to their Profile, and the
 * row's action when the viewer has one. A User without a username has no
 * Profile to open, so the row is not a link.
 */
function FollowListRow({
  user,
  action,
  pending,
  onAction,
}: {
  user: FollowListUser;
  action: FollowListRowAction | null;
  pending: boolean;
  onAction: (action: FollowListRowAction) => void;
}) {
  const t = useTranslations('publicProfile.followList');
  const body = (
    <>
      <UserAvatar user={user} className={AVATAR_CLASS} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="truncate font-semibold text-sm">{user.name}</span>
          <UserIdentityMarks identity={user.avatarIdentity} />
        </span>
        {user.username === null ? null : (
          <span className="truncate text-muted-foreground text-xs">
            @{user.username}
          </span>
        )}
      </span>
    </>
  );
  return (
    // The hover sits on the row so it wraps the action button too; the button
    // stays a sibling of the link, never inside it, so its click can't navigate.
    <li
      className={`flex items-center gap-2 rounded-2xl pr-2 transition-colors ${
        user.username === null ? '' : 'hover:bg-accent'
      }`}
    >
      {user.username === null ? (
        <div className={ROW_CLASS}>{body}</div>
      ) : (
        <Link href={`/users/${user.username}`} className={ROW_CLASS}>
          {body}
        </Link>
      )}
      {action === null ? null : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => onAction(action)}
        >
          {t(action)}
        </Button>
      )}
    </li>
  );
}
