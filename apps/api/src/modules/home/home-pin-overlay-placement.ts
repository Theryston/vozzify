import type { HomeRow } from '@vozzify/contracts';
import {
  HOME_PAGE_SIZE,
  PERSONAL_DISCOVERY_ROW_MIN_ITEMS,
} from './home-rules.js';

const isQualityCategory = (row: HomeRow): boolean =>
  (row.layout === 'albums' ||
    row.layout === 'artists' ||
    row.layout === 'people') &&
  row.items.length >= PERSONAL_DISCOVERY_ROW_MIN_ITEMS;

const rowAtSlot = (options: {
  index: number;
  heroSlot: number;
  dailyTargetSlot: number;
  hero: HomeRow | undefined;
  dailyTarget: HomeRow | undefined;
  pinned: ReadonlyMap<number, HomeRow>;
}): HomeRow | undefined => {
  const { index, heroSlot, dailyTargetSlot, hero, dailyTarget, pinned } =
    options;
  if (index === heroSlot) return hero;
  if (index === dailyTargetSlot) return dailyTarget;
  return pinned.get(index);
};

const placeRows = (options: {
  hero: HomeRow | undefined;
  dailyTarget: HomeRow | undefined;
  pinnedSlots: ReadonlyMap<number, HomeRow>;
  algorithmic: readonly HomeRow[];
  categorySlot: number | undefined;
  categoryRow: HomeRow | undefined;
}): HomeRow[] => {
  const {
    hero,
    dailyTarget,
    pinnedSlots,
    algorithmic,
    categorySlot,
    categoryRow,
  } = options;
  const heroSlot = hero ? 0 : -1;
  const dailyTargetSlot = dailyTarget ? (hero ? 1 : 0) : -1;
  const lastSlot = Math.max(heroSlot, dailyTargetSlot, ...pinnedSlots.keys());
  const queue = algorithmic.filter((row) => row !== categoryRow);
  const rows: HomeRow[] = [];
  for (let index = 0; queue.length > 0 || index <= lastSlot; index += 1) {
    const slot = rowAtSlot({
      index,
      heroSlot,
      dailyTargetSlot,
      hero,
      dailyTarget,
      pinned: pinnedSlots,
    });
    const row = index === categorySlot ? categoryRow : (slot ?? queue.shift());
    if (row) rows.push(row);
  }
  return rows;
};

const reserveQualityCategory = (options: {
  mandatorySlots: ReadonlySet<number>;
  assignedPins: ReadonlyMap<number, HomeRow>;
}): { categorySlot: number; pinnedSlots: Map<number, HomeRow> } => {
  const { mandatorySlots, assignedPins } = options;
  const pinnedSlots = new Map(assignedPins);
  const openSlot = Array.from(
    { length: HOME_PAGE_SIZE },
    (_, index) => index,
  ).find((index) => !mandatorySlots.has(index) && !pinnedSlots.has(index));
  if (openSlot !== undefined) return { categorySlot: openSlot, pinnedSlots };

  // All first-page positions are committed. Move only the pin at the reserved
  // slot, after every other pin's already assigned position.
  const categorySlot = HOME_PAGE_SIZE - 1;
  const displaced = pinnedSlots.get(categorySlot);
  if (displaced) {
    pinnedSlots.delete(categorySlot);
    const nextSlot = Math.max(...pinnedSlots.keys(), categorySlot) + 1;
    pinnedSlots.set(nextSlot, displaced);
  }
  return { categorySlot, pinnedSlots };
};

/** Keep an eligible quality category on page one without shifting fixed pins. */
export const placeRowsWithQualityCategory = (options: {
  hero: HomeRow | undefined;
  dailyTarget: HomeRow | undefined;
  algorithmic: readonly HomeRow[];
  mandatorySlots: ReadonlySet<number>;
  assignedPins: ReadonlyMap<number, HomeRow>;
}): HomeRow[] => {
  const { hero, dailyTarget, algorithmic, mandatorySlots, assignedPins } =
    options;
  const placed = placeRows({
    hero,
    dailyTarget,
    pinnedSlots: assignedPins,
    algorithmic,
    categorySlot: undefined,
    categoryRow: undefined,
  });
  const category = placed.find(
    (row, index) => index >= HOME_PAGE_SIZE && isQualityCategory(row),
  );
  if (!category) return placed;
  const reservation = reserveQualityCategory({ mandatorySlots, assignedPins });
  return placeRows({
    hero,
    dailyTarget,
    pinnedSlots: reservation.pinnedSlots,
    algorithmic,
    categorySlot: reservation.categorySlot,
    categoryRow: category,
  });
};
