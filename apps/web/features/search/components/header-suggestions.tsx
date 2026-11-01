'use client';

import type { SearchResultItem } from '@vozzify/contracts';
import { SearchIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { Popover, PopoverContent } from '@/components/ui/popover';
import { Toaster } from '@/components/ui/sonner';
import { Spinner } from '@/components/ui/spinner';
import { SessionUserBoundary } from '@/features/auth/components/session-user';
import { RequestTrackAction } from '@/features/tracks/components/request-track-action';
import { TrackCoverArt } from '@/features/tracks/components/track-cover-art';
import { Link } from '@/lib/i18n/navigation';

import {
  SUGGESTIONS_LISTBOX_ID,
  suggestionRowId,
  suggestionRowLayout,
  suggestionRowProps,
} from '../combobox-keys';
import { useSearchSuggestions } from '../hooks/use-search-suggestions';
import { searchPathFrom, signInToRequestHref } from '../request-sign-in';
import { searchHref } from '../search-href';
import { normalizeSearchQuery } from '../search-params';
import { type ResultViewer, resultAction } from '../search-result-action';
import { toTrackCardProps } from '../search-result-to-track-card';
import { suggestionPanelContent } from '../suggestion-panel';

/**
 * A row is at least 56px tall (DESIGN.md: list rows). The highlight is the
 * keyboard's current row, shown with the same wash as the hover.
 */
const ROW_CLASS =
  'flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-highlighted:bg-foreground/10';
const LINK_ROW_CLASS = `${ROW_CLASS} transition-colors duration-150 ease-out hover:bg-foreground/10`;
const BUTTON_ROW_CLASS = `${LINK_ROW_CLASS} w-full text-left disabled:cursor-progress`;

/**
 * The Toaster of the header's failed requests. A page with its own Toaster
 * (the Track page, the profile form) would show a header toast too, so the
 * header's toasts are tagged with this id and only this Toaster shows them.
 */
const HEADER_TOASTER_ID = 'header-suggestions';

/**
 * Same clearance as the Track page's toasts, so a toast never lands on the
 * practice dock.
 */
const TOAST_CLEARANCE = {
  bottom: 'calc(var(--dock-height, 0px) + 1.5rem)',
};

type RowProps = ReturnType<typeof suggestionRowProps>;

/** The 48px square cover of a row: the art, or the placeholder without it. */
function SuggestionCover({
  coverArtUrl,
  placeholderSeed,
}: {
  coverArtUrl?: string | null;
  placeholderSeed: string;
}) {
  return (
    <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
      <TrackCoverArt
        coverArtUrl={coverArtUrl}
        placeholderSeed={placeholderSeed}
        sizes="48px"
      />
    </span>
  );
}

/** Title and artist credit, so same-title Recordings can be told apart. */
function SuggestionText({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium text-sm">{title}</span>
      <span className="truncate text-muted-foreground text-xs">{subtitle}</span>
    </span>
  );
}

/**
 * The trailing chip of a row without a Track: "No notes yet", or the spinner
 * and "Generating…" while its request is on its way (the card's feedback).
 */
function NoNotesMarker({
  pending,
  label,
}: {
  pending: boolean;
  label: string;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
      {pending ? <Spinner className="size-3" /> : null}
      {label}
    </span>
  );
}

/**
 * A Recording without a Track that a signed-in visitor with a username can
 * request: a click asks for its notes, the same request the search card
 * fires. Once the Track exists the field lets go of the query, as a pick does
 * (the request then navigates to the Processing page). Keyboard Enter on the
 * highlighted row clicks it, so it takes the same path.
 */
function RequestSuggestionRow({
  item,
  content,
  rowProps,
  onPickTrack,
}: {
  item: SearchResultItem;
  /** The cover and the title, as the row shows them. */
  content: ReactNode;
  rowProps: RowProps;
  onPickTrack: () => void;
}) {
  const t = useTranslations('header.search.suggestions');
  return (
    <RequestTrackAction
      recordingMbid={item.mbid}
      onRequested={onPickTrack}
      toasterId={HEADER_TOASTER_ID}
    >
      {({ pending, onRequest }) => (
        <button
          {...rowProps}
          type="button"
          aria-busy={pending}
          aria-label={t('generateLabel', { title: item.title })}
          disabled={pending}
          onClick={onRequest}
          className={BUTTON_ROW_CLASS}
        >
          {content}
          <NoNotesMarker
            pending={pending}
            label={pending ? t('generating') : t('noNotesYet')}
          />
        </button>
      )}
    </RequestTrackAction>
  );
}

/**
 * One Recording option. With a Track it is a link to that Track page, and a
 * pick clears the field (the next page should not reopen the old query).
 * Without a Track the row follows the result card: a signed-in visitor with a
 * username requests the notes, a signed-out one goes to sign in first and comes
 * back to `searchPath` with the request marker, anyone else sees a static row.
 * Every row without a Track shows the "No notes yet" marker.
 */
function SuggestionRow({
  item,
  user,
  searchPath,
  rowProps,
  onPickTrack,
}: {
  item: SearchResultItem;
  user: ResultViewer;
  searchPath: string;
  rowProps: RowProps;
  onPickTrack: () => void;
}) {
  const t = useTranslations('header.search.suggestions');
  const card = toTrackCardProps(item);
  const content = (
    <>
      <SuggestionCover
        coverArtUrl={card.coverArtUrl}
        placeholderSeed={card.placeholderSeed}
      />
      <SuggestionText title={card.title} subtitle={card.subtitle} />
    </>
  );
  if (card.trackId !== null) {
    return (
      <Link
        {...rowProps}
        href={`/tracks/${card.trackId}`}
        onClick={onPickTrack}
        className={LINK_ROW_CLASS}
      >
        {content}
      </Link>
    );
  }
  const action = resultAction(item, user);
  if (action === 'request') {
    return (
      <RequestSuggestionRow
        item={item}
        content={content}
        rowProps={rowProps}
        onPickTrack={onPickTrack}
      />
    );
  }
  const marker = <NoNotesMarker pending={false} label={t('noNotesYet')} />;
  if (action === 'sign-in') {
    return (
      <Link
        {...rowProps}
        href={signInToRequestHref(searchPath, item.mbid)}
        aria-label={t('signInLabel', { title: card.title })}
        className={LINK_ROW_CLASS}
      >
        {content}
        {marker}
      </Link>
    );
  }
  return (
    <div {...rowProps} className={ROW_CLASS}>
      {content}
      {marker}
    </div>
  );
}

/**
 * The listbox and its options: the Recordings in rank order, the "No songs"
 * line, and the trailing Search-for option. Built once the viewer is known,
 * so each row can pick its action.
 */
function SuggestionOptions({
  items,
  noSongs,
  searchForHref,
  searchPath,
  highlighted,
  onPickTrack,
  onPickSearch,
}: {
  items: SearchResultItem[];
  noSongs: boolean;
  searchForHref: ReturnType<typeof searchHref>;
  searchPath: string;
  highlighted: number | null;
  onPickTrack: () => void;
  onPickSearch: () => void;
}) {
  const t = useTranslations('header.search.suggestions');
  const { searchForIndex } = suggestionRowLayout(items.length);
  return (
    <SessionUserBoundary
      render={(user) => (
        <div
          role="listbox"
          id={SUGGESTIONS_LISTBOX_ID}
          aria-label={t('label')}
          className="flex flex-col"
        >
          {items.map((item, index) => (
            <SuggestionRow
              key={item.mbid}
              item={item}
              user={user}
              searchPath={searchPath}
              rowProps={suggestionRowProps(index, highlighted)}
              onPickTrack={onPickTrack}
            />
          ))}
          {noSongs ? (
            <div
              role="presentation"
              className={`${ROW_CLASS} text-muted-foreground text-sm`}
            >
              {t('noSongs')}
            </div>
          ) : null}
          {searchForHref ? (
            <Link
              {...suggestionRowProps(searchForIndex, highlighted)}
              href={searchForHref}
              onClick={onPickSearch}
              className={`${LINK_ROW_CLASS} font-medium text-sm`}
            >
              <SearchIcon aria-hidden="true" className="size-4" />
              {t('searchFor', { query: searchForHref.query.q })}
            </Link>
          ) : null}
        </div>
      )}
    />
  );
}

/**
 * The header suggestions: up to twenty Recordings in catalog rank order, then
 * the trailing "Search for" option that goes to the full search. A settled
 * empty answer adds a "No songs found" line above it (the full search answers
 * the same query). The panel is anchored to the search bar, full width on
 * small screens.
 *
 * The rows form a listbox the field names with `aria-controls`; the highlight
 * is the field's `aria-activedescendant`. A press on the panel never moves
 * focus, so the field does not blur (which would close the panel) before the
 * click lands.
 */
export function HeaderSuggestions({
  query,
  anchor,
  highlighted,
  onRowsChange,
  onPickTrack,
  onPickSearch,
}: {
  query: string;
  anchor: RefObject<Element | null>;
  /** The row the keyboard highlights: an index, the Search-for row last. */
  highlighted: number | null;
  /** Reports the rows on screen, so the arrow keys wrap inside them. */
  onRowsChange: (count: number) => void;
  onPickTrack: () => void;
  onPickSearch: () => void;
}) {
  const { data } = useSearchSuggestions(query);
  const results = data?.results;
  const { items, noSongs } = suggestionPanelContent(results);
  const searchForHref = searchHref(query);
  // The sign-in round trip returns to this search, as the search page has it.
  const searchPath = searchPathFrom(normalizeSearchQuery(query));

  // A new answer is a new set of rows: the list reports them so the highlight
  // starts over. The row count (Search-for included) is the layout's.
  useEffect(() => {
    onRowsChange(suggestionRowLayout(results?.length ?? 0).rowCount);
  }, [results, onRowsChange]);

  useEffect(() => {
    if (highlighted === null) return;
    document
      .getElementById(suggestionRowId(highlighted))
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  return (
    <>
      <Popover open>
        <PopoverContent
          anchor={anchor}
          initialFocus={false}
          finalFocus={false}
          role="presentation"
          onMouseDown={(event: MouseEvent) => event.preventDefault()}
          className="max-h-96 w-(--anchor-width) gap-0 overflow-y-auto rounded-xl p-1"
        >
          <SuggestionOptions
            items={items}
            noSongs={noSongs}
            searchForHref={searchForHref}
            searchPath={searchPath}
            highlighted={highlighted}
            onPickTrack={onPickTrack}
            onPickSearch={onPickSearch}
          />
        </PopoverContent>
      </Popover>
      {/*
        The home page mounts no Toaster, so the header's failures get one. It is
        portaled to the body: the header is `.glass`, and its backdrop filter
        would make it the containing block of the toast's fixed position.
      */}
      {createPortal(
        <Toaster
          id={HEADER_TOASTER_ID}
          offset={TOAST_CLEARANCE}
          mobileOffset={TOAST_CLEARANCE}
        />,
        document.body,
      )}
    </>
  );
}
