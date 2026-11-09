import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  type CreateEditorialPinBody,
  createEditorialPinBodySchema,
  EDITORIAL_PIN_MAX_TRACKS,
  type EditorialPin,
  type EditorialPinActor,
  type EditorialPinDynamicSource,
  type EditorialPinHistoryEntry,
  type EditorialPinHistoryPage,
  type EditorialPinPage,
  type Locale,
  type PinTrackSearchQuery,
  type PinTrackSearchResult,
  type PinTrackSummary,
  type UpdateEditorialPinBody,
} from '@vozzify/contracts';
import {
  decodeTupleCursor,
  encodeTupleCursor,
} from '../../common/cursor/tuple-cursor.js';
import { AppException } from '../../common/errors/app-exception.js';
import { EditorialPinScheduleService } from './editorial-pin-schedule.service.js';
import { assertSourceEligible } from './editorial-pin-source-eligibility.js';
import {
  affectedLocales,
  changedFieldsOf,
  EDITORIAL_PIN_STATE_FIELDS,
  type EditorialPinWrite,
  type PageCursor,
  type SourceTrackQuery,
  stateOf,
  toEditorialPin,
} from './editorial-pin-state.js';
import { editorialPinWriteOf, previewPinOf } from './editorial-pin-write.js';
import {
  type EditorialPinHistoryRecord,
  type EditorialPinRecord,
  EditorialPinsRepository,
} from './editorial-pins.repository.js';
import type { PinTrackRecord } from './editorial-pins-query.repository.js';

/** A record with what the pin picker shows to pick it. */
const toPinTrackSummary = (record: PinTrackRecord): PinTrackSummary => ({
  id: record.id,
  title: record.title,
  artistCredit: record.artistCredit.map(({ name, joinPhrase }) => ({
    name,
    joinPhrase,
  })),
  coverUrl: record.coverUrl,
});

/** A page request: the cursor of the previous page, and how many items. */
type PageQuery = { cursor?: string | undefined; limit: number };

/** The page of `rows` that `limit` asks for, and the cursor of the next one. */
const cursorPageOf = <TRecord extends { createdAt: Date; id: string }, TItem>(
  rows: TRecord[],
  limit: number,
  toItem: (record: TRecord) => TItem,
): { items: TItem[]; nextCursor: string | null } => {
  const shown = rows.slice(0, limit);
  const last = rows.length > limit ? shown.at(-1) : undefined;
  return {
    items: shown.map(toItem),
    nextCursor: last
      ? encodeTupleCursor([last.createdAt.toISOString(), last.id])
      : null,
  };
};

const decodeCursor = (cursor: string | undefined): PageCursor | undefined => {
  if (cursor === undefined) {
    return undefined;
  }
  const [createdAt, id] = decodeTupleCursor(cursor);
  const time = new Date(createdAt);
  if (Number.isNaN(time.getTime())) {
    throw new AppException('VALIDATION_FAILED', 'Invalid cursor');
  }
  return { createdAt: time, id };
};

const toHistoryEntry = (
  entry: EditorialPinHistoryRecord,
): EditorialPinHistoryEntry => ({
  id: entry.id,
  pinId: entry.pinId,
  action: entry.action,
  changedFields: entry.changedFields,
  actor: entry.actor,
  state: entry.state,
  createdAt: entry.createdAt.toISOString(),
});

/**
 * Admin writes of the editorial pins: validation, the history of every change,
 * and the cache invalidations that make a change show at once. Reads and writes
 * the pin as its admin sees it; the home reads the live ones through
 * `findLivePins`.
 */
@Injectable()
export class EditorialPinsService {
  constructor(
    private readonly pins: EditorialPinsRepository,
    private readonly schedule: EditorialPinScheduleService,
  ) {}

  async list(query: PageQuery): Promise<EditorialPinPage> {
    const rows = await this.pins.findPage({
      after: decodeCursor(query.cursor),
      limit: query.limit,
    });
    return cursorPageOf(rows, query.limit, toEditorialPin);
  }

  async get(pinId: string): Promise<EditorialPin> {
    return toEditorialPin(await this.require(pinId));
  }

  /** Refuses a preview for an incomplete Track or an empty dynamic source. */
  async assertPreviewEligible(body: CreateEditorialPinBody): Promise<void> {
    await this.assertSourceEligible(editorialPinWriteOf(body));
  }

  /** Builds a transient pin using the same write mapping as a stored pin. */
  preview(body: CreateEditorialPinBody, pinId?: string): EditorialPin {
    return previewPinOf(body, pinId);
  }

  /** The changes of a pin, newest first. A removed pin keeps its history. */
  async history(
    pinId: string,
    query: PageQuery,
  ): Promise<EditorialPinHistoryPage> {
    const rows = await this.pins.findHistoryPage({
      pinId,
      after: decodeCursor(query.cursor),
      limit: query.limit,
    });
    // Every pin has a CREATED entry, and a removed pin keeps its entries, so an
    // empty first page means no pin ever had this ID.
    if (rows.length === 0 && query.cursor === undefined) {
      throw new AppException('NOT_FOUND', 'Home pin not found');
    }
    return cursorPageOf(rows, query.limit, toHistoryEntry);
  }

  async create(
    body: CreateEditorialPinBody,
    actor: EditorialPinActor,
  ): Promise<EditorialPin> {
    const write = editorialPinWriteOf(body);
    await this.assertSourceEligible(write);
    const pinId = await this.insertWithHistory(write, actor);
    const pin = toEditorialPin(await this.require(pinId));
    await this.announce(pin, pin.locale);
    return pin;
  }

  /** A partial update: the merged pin is checked as a whole, like a create. */
  async update(
    pinId: string,
    patch: UpdateEditorialPinBody,
    actor: EditorialPinActor,
  ): Promise<EditorialPin> {
    const current = await this.require(pinId);
    const currentState = toEditorialPin(current);
    const merged = createEditorialPinBodySchema.safeParse({
      ...currentState,
      ...patch,
    });
    if (!merged.success) {
      throw new AppException('VALIDATION_FAILED', 'The pin is invalid', {
        location: 'body',
        issues: merged.error.issues,
      });
    }
    const next = editorialPinWriteOf(merged.data);
    const changed = changedFieldsOf(currentState, stateOf(next));
    if (changed.length === 0) {
      return currentState;
    }
    if (changed.some((field) => ['kind', 'layout', 'source'].includes(field))) {
      await this.assertSourceEligible(next);
    }
    await this.updateWithHistory(pinId, next, changed, actor);
    const updated = toEditorialPin(await this.require(pinId));
    await this.announce(updated, current.locale);
    return updated;
  }

  /**
   * The Tracks a dynamic source offers now, best first, as the feed shows them.
   * A hero reads only Tracks with a cover, and a row takes up to `limit`.
   */
  findSourceTrackIds(
    source: EditorialPinDynamicSource,
    query: SourceTrackQuery,
  ): Promise<string[]> {
    return this.pins.findSourceTrackIds(source, query);
  }

  /**
   * Summaries of the Tracks the pin picker may offer (`q`, completed and
   * kind-eligible, hottest first) or shows (`ids`, the ones an edited pin
   * already holds, in that order). Only completed Tracks ever come back, so
   * the picker never offers a Track the pin would refuse.
   */
  async searchPinTracks(
    query: PinTrackSearchQuery,
  ): Promise<PinTrackSearchResult> {
    if (query.q !== undefined) {
      const items = await this.pins.searchPinTracks({
        q: query.q,
        kind: query.kind,
        limit: query.limit,
      });
      return { items: items.map(toPinTrackSummary) };
    }
    const ids = [
      ...new Set(
        (query.ids ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    ].slice(0, EDITORIAL_PIN_MAX_TRACKS);
    const items = await this.pins.findPinTracksByIds(ids);
    return { items: items.map(toPinTrackSummary) };
  }

  async remove(pinId: string, actor: EditorialPinActor): Promise<void> {
    const current = await this.require(pinId);
    await this.deleteWithHistory(current, actor);
    await this.schedule.invalidateNow(affectedLocales(current.locale));
  }

  /**
   * The pins a request sees right now, in precedence order. Read at request
   * time, never stored in the feed: a pin starting or ending needs no
   * regeneration.
   */
  async findLivePins(options: {
    locale: Locale;
    signedIn: boolean;
    now?: Date;
  }): Promise<EditorialPin[]> {
    const rows = await this.pins.findLive({
      locale: options.locale,
      signedIn: options.signedIn,
      now: options.now ?? new Date(),
    });
    return rows.map((row) => toEditorialPin(row));
  }

  private async require(pinId: string): Promise<EditorialPinRecord> {
    const pin = await this.pins.findById(pinId);
    if (!pin) {
      throw new AppException('NOT_FOUND', 'Home pin not found');
    }
    return pin;
  }

  private async assertSourceEligible(write: EditorialPinWrite): Promise<void> {
    await assertSourceEligible(this.pins, write);
  }

  /** Revalidates the home of the locales the pin was and is in, now. */
  private async announce(
    pin: EditorialPin,
    previousLocale: Locale | null,
  ): Promise<void> {
    const locales = [
      ...new Set([
        ...affectedLocales(previousLocale),
        ...affectedLocales(pin.locale),
      ]),
    ];
    await this.schedule.invalidateNow(locales);
    await this.schedule.scheduleEdges(pin);
  }

  @Transactional()
  private async insertWithHistory(
    write: EditorialPinWrite,
    actor: EditorialPinActor,
  ): Promise<string> {
    const pinId = await this.pins.insertPin(write, actor.id);
    await this.pins.insertHistory({
      pinId,
      action: 'CREATED',
      changedFields: [...EDITORIAL_PIN_STATE_FIELDS],
      state: stateOf(write),
      actorId: actor.id,
    });
    return pinId;
  }

  @Transactional()
  private async updateWithHistory(
    pinId: string,
    write: EditorialPinWrite,
    changedFields: string[],
    actor: EditorialPinActor,
  ): Promise<void> {
    await this.pins.updatePin(pinId, write, actor.id);
    await this.pins.insertHistory({
      pinId,
      action: 'UPDATED',
      changedFields,
      state: stateOf(write),
      actorId: actor.id,
    });
  }

  @Transactional()
  private async deleteWithHistory(
    current: EditorialPinRecord,
    actor: EditorialPinActor,
  ): Promise<void> {
    await this.pins.insertHistory({
      pinId: current.id,
      action: 'DELETED',
      changedFields: [],
      state: stateOf(current),
      actorId: actor.id,
    });
    await this.pins.deletePin(current.id);
  }
}
