'use client';

import type { TrackContributorEntry } from '@vozzify/contracts';
import { SearchIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type RefObject, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAvatarStatusText } from '@/features/auth/components/avatar-status';
import { UserIdentityMarks } from '@/features/auth/components/user-identity-marks';
import { Link } from '@/lib/i18n/navigation';

import { useContributors } from '../hooks/use-contributors';
import { ContributorAvatar } from './contributor-avatar';
import { ContributorFollowButton } from './contributor-follow-button';

type ContributorsQuery = ReturnType<typeof useContributors>;

type ContributorResultBodyProps = {
  trackId: string;
  query: string;
  items: TrackContributorEntry[];
  total: number;
  isPending: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  list: RefObject<HTMLUListElement | null>;
  sentinel: RefObject<HTMLLIElement | null>;
};

function ContributorResultBody({
  trackId,
  query,
  items,
  total,
  isPending,
  isFetchingNextPage,
  hasNextPage,
  list,
  sentinel,
}: ContributorResultBodyProps) {
  const t = useTranslations('tracks.practice.contributorsDialog');
  const shown = items.length;

  return (
    <>
      {isPending ? (
        <p
          role="status"
          className="py-6 text-center text-muted-foreground text-sm"
        >
          {t('loading')}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs tabular-nums">
          {t('showing', { shown, total })}
        </p>
      )}
      {isPending ? null : items.length === 0 && !isFetchingNextPage ? (
        <p className="py-6 text-center text-muted-foreground text-sm">
          {t('empty', { query })}
        </p>
      ) : (
        <ul
          ref={list}
          className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
        >
          {items.map((item) => (
            <ContributorRow
              key={item.id}
              trackId={trackId}
              contributor={item}
            />
          ))}
          {hasNextPage ? (
            <li ref={sentinel} aria-hidden="true" className="h-px shrink-0" />
          ) : null}
        </ul>
      )}
      {isFetchingNextPage ? (
        <p role="status" className="text-center text-muted-foreground text-sm">
          {t('loadingMore')}
        </p>
      ) : null}
    </>
  );
}

const SEARCH_DEBOUNCE_MS = 300;
const AVATAR_CLASS = 'size-12';

/**
 * One Contributor: Avatar, name and handle, linking to their Profile, and the
 * follow button for a signed-in viewer.
 */
function ContributorRow({
  trackId,
  contributor,
}: {
  trackId: string;
  contributor: TrackContributorEntry;
}) {
  const tp = useTranslations('tracks.practice');
  const statusText = useAvatarStatusText();
  const body = (
    <>
      <ContributorAvatar contributor={contributor} className={AVATAR_CLASS} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="truncate font-semibold text-sm">
            {contributor.name}
          </span>
          <UserIdentityMarks identity={contributor.avatarIdentity} />
        </span>
        {contributor.username === null ? null : (
          <span className="truncate text-muted-foreground text-xs">
            @{contributor.username}
          </span>
        )}
      </span>
    </>
  );
  const className =
    'flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl pl-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
  return (
    // The hover sits on the row so it wraps the follow button too; the button
    // stays a sibling of the link, never inside it, so its click can't navigate.
    <li
      className={`flex items-center gap-2 rounded-2xl pr-2 transition-colors ${
        contributor.username === null ? '' : 'hover:bg-accent'
      }`}
    >
      {contributor.username === null ? (
        <div className={className}>{body}</div>
      ) : (
        <Link
          href={`/users/${contributor.username}`}
          aria-description={statusText(contributor.avatarIdentity)}
          aria-label={tp('contributorLink', { name: contributor.name })}
          className={className}
        >
          {body}
        </Link>
      )}
      <ContributorFollowButton trackId={trackId} contributor={contributor} />
    </li>
  );
}

/** Pill search field following the DESIGN.md input group. */
function ContributorsSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('tracks.practice.contributorsDialog');
  return (
    <label className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-muted px-4 transition-shadow focus-within:ring-3 focus-within:ring-ring/50">
      <SearchIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('search')}
        aria-label={t('search')}
        className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

/** Query result, rows and loading states for the dialog. */
function ContributorsResults({
  trackId,
  query,
  result,
}: {
  trackId: string;
  query: string;
  result: ContributorsQuery;
}) {
  const t = useTranslations('tracks.practice.contributorsDialog');
  const list = useRef<HTMLUListElement>(null);
  const sentinel = useRef<HTMLLIElement>(null);
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    refetch,
  } = result;

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
  }, [error, fetchNextPage, hasNextPage, isFetchingNextPage]);

  const items = (data?.pages ?? []).flatMap((page) => page.items);
  const total = data?.pages[0]?.total ?? 0;

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <p role="alert" className="text-muted-foreground text-sm">
          {t('loadError')}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="h-10 rounded-full bg-secondary px-4 font-semibold text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <ContributorResultBody
      trackId={trackId}
      query={query}
      items={items}
      total={total}
      isPending={isPending}
      isFetchingNextPage={isFetchingNextPage}
      hasNextPage={hasNextPage ?? false}
      list={list}
      sentinel={sentinel}
    />
  );
}

/** Infinite Contributor rows with search, status and retry. */
function ContributorsList({ trackId }: { trackId: string }) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);
  const result = useContributors(trackId, query);

  return (
    <>
      <ContributorsSearch value={input} onChange={setInput} />
      <ContributorsResults trackId={trackId} query={query} result={result} />
    </>
  );
}

/** Every Contributor of the Track: search plus infinite scroll. */
export function ContributorsDialog({
  trackId,
  open,
  onOpenChange,
}: {
  trackId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('tracks.practice.contributorsDialog');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t('close')}
        className="max-h-[80dvh] overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ContributorsList trackId={trackId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
