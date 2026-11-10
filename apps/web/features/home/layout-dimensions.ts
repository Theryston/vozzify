/**
 * Outer sizes of the home's blocks, shared by the rows and their skeletons so
 * a skeleton reserves exactly the space its final content takes (no shift).
 */

export const HERO_BLOCK_CLASS = 'min-h-72 md:min-h-80';

export const CAROUSEL_HEADER_CLASS = 'flex flex-col';

export const CAROUSEL_TITLE_CLASS = 'font-bold text-xl tracking-tight';

/** The title's skeleton: one text-xl line (28px, `h-7`) of a typical title width. */
export const CAROUSEL_TITLE_SKELETON_CLASS = 'h-7 w-56 rounded-md';

/** One carousel card: the same width as a `TrackCard` in a snap track. */
export const CAROUSEL_ITEM_CLASS = 'w-40 shrink-0 snap-start sm:w-44 md:w-48';

export const CAROUSEL_TRACK_CLASS =
  '-mx-4 flex snap-none scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 data-[carousel-desktop=true]:snap-x data-[carousel-desktop=true]:snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** Sizes hint for a carousel cover: its rendered width at each breakpoint. */
export const CAROUSEL_COVER_SIZES =
  '(max-width: 640px) 160px, (max-width: 768px) 176px, 192px';

/** Sizes hint for the hero's cover, which takes the block's right half. */
export const HERO_COVER_SIZES = '(max-width: 768px) 50vw, 40vw';

/**
 * The daily target strip: one thin bar with the time left and the streak, so
 * the skeleton reserves exactly its height (no shift when it lands).
 */
export const DAILY_TARGET_STRIP_CLASS =
  'flex min-h-16 items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3';

/** A ranked Top 10: the title line, then the numbered rows. */
export const RANKED_HEADER_CLASS = 'flex flex-col';

export const RANKED_TITLE_CLASS = 'font-bold text-xl tracking-tight';

/** The title's skeleton: one text-xl line (28px, `h-7`) of a typical title width. */
export const RANKED_TITLE_SKELETON_CLASS = 'h-7 w-56 rounded-md';

/** The ranked list: rows of number, cover and text, dividers between them. */
export const RANKED_LIST_CLASS =
  'flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-sm';

/** One ranked row: a large touch target that navigates as one link. */
export const RANKED_ITEM_CLASS =
  'flex min-h-16 items-center gap-3 px-4 py-2 outline-none transition-colors duration-150 ease-out hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset';

/** The rank number: big, tabular, quiet. The list order carries the meaning. */
export const RANKED_RANK_CLASS =
  'w-8 shrink-0 text-center font-mono text-2xl font-extrabold tabular-nums text-muted-foreground';

/** One ranked title: one line, truncated, like a card title. */
export const RANKED_ITEM_TITLE_CLASS = 'truncate font-semibold text-sm';

/** The artist and vocal range under it, like a card's metadata line. */
export const RANKED_ITEM_SUBTITLE_CLASS =
  'truncate font-medium text-muted-foreground text-xs';

/** A skeleton text line inside a ranked row, at the subtitle's size. */
export const RANKED_META_SKELETON_CLASS = 'h-4 w-2/3 rounded-md';

/** Sizes hint for a ranked cover: its fixed 48px width. */
export const RANKED_COVER_SIZES = '48px';

/** One genre tile: the same width as a carousel card, shorter than a cover. */
export const GENRE_TILE_ITEM_CLASS = 'w-40 shrink-0 snap-start sm:w-44 md:w-48';

/** One genre tile's block: a fixed height, so the row never shifts. */
export const GENRE_TILE_BLOCK_CLASS =
  'relative block h-24 overflow-hidden rounded-2xl md:h-28';

/** One artist in the row: a circle with the name under it. */
export const ARTIST_ROW_ITEM_CLASS = 'w-24 shrink-0 snap-start md:w-28';

/** One album card: the cover's width, like a carousel card. */
export const ALBUM_ROW_ITEM_CLASS = 'w-40 shrink-0 snap-start sm:w-44 md:w-48';
