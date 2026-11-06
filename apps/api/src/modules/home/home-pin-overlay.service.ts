import { Injectable } from '@nestjs/common';
import {
  type CreateEditorialPinBody,
  EDITORIAL_PIN_MAX_TRACKS,
  type EditorialPin,
  type HomeRow,
  type HomeRowTitle,
  type HomeTrack,
  type Locale,
} from '@vozzify/contracts';
import { EditorialPinsService } from '../editorial-pins/editorial-pins.service.js';
import { HomeRepository } from './home.repository.js';
import { toHomeTrack } from './home-feed-builder.service.js';
import { applyEditorialPins, type OverlayPin } from './home-pin-overlay.js';
import { toHomeCandidate } from './home-row-sources.js';

/**
 * The title key of a pinned row. Its text is the admin's, in the locale of the
 * feed, sent as the `title` parameter: the web renders it as `{title}`.
 */
export const PINNED_ROW_TITLE_KEY = 'home.rows.pinned';

type Viewer = {
  locale: Locale;
  signedIn: boolean;
  audience?: 'public' | 'personal';
};

/**
 * Reads the pins live for a viewer and applies them over the feed rows. The
 * Tracks of the pins are read here (completed ones only), so a Track that
 * became ineligible is skipped without any regeneration.
 */
@Injectable()
export class HomePinOverlayService {
  constructor(
    private readonly pins: EditorialPinsService,
    private readonly homeRepository: HomeRepository,
  ) {}

  async apply(rows: HomeRow[], viewer: Viewer): Promise<HomeRow[]> {
    const live = await this.pins.findLivePins(viewer);
    return this.applyPins(rows, viewer, live);
  }

  /** Refreshes only Pins already occupying frozen visit slots. */
  async refreshFrozen(rows: HomeRow[], viewer: Viewer): Promise<HomeRow[]> {
    const frozenIds = new Set(
      rows.flatMap((row) =>
        row.id.startsWith('pin-') ? [row.id.slice(4)] : [],
      ),
    );
    if (frozenIds.size === 0) return rows;
    const live = (await this.pins.findLivePins(viewer)).filter((pin) =>
      frozenIds.has(pin.id),
    );
    const algorithmicRows = rows.filter((row) => !row.id.startsWith('pin-'));
    return this.applyPins(algorithmicRows, viewer, live);
  }

  /** Applies a validated draft while replacing its saved version, if any. */
  async applyPreview(
    rows: HomeRow[],
    viewer: Viewer,
    body: CreateEditorialPinBody,
    pinId?: string,
  ): Promise<HomeRow[]> {
    const [live] = await Promise.all([
      this.pins.findLivePins(viewer),
      this.pins.assertPreviewEligible(body),
    ]);
    const draft = this.pins.preview(body, pinId);
    const pins = live.filter((pin) => pin.id !== draft.id);
    if (targetsViewer(draft, viewer)) {
      pins.push(draft);
    }
    return this.applyPins(rows, viewer, pins);
  }

  private async applyPins(
    rows: HomeRow[],
    viewer: Viewer,
    live: EditorialPin[],
  ): Promise<HomeRow[]> {
    if (live.length === 0 && (viewer.audience ?? 'public') === 'public') {
      return rows;
    }
    if (live.length === 0) {
      return applyEditorialPins(rows, [], viewer.audience ?? 'public');
    }
    // A genre, artist or album pin names no Tracks of its own: its Tracks are
    // read here, so a newly processed Track shows without an edit of the pin.
    const resolved = new Map<string, string[]>();
    for (const pin of live) {
      if (pin.source.type !== 'tracks') {
        resolved.set(
          pin.id,
          await this.pins.findSourceTrackIds(pin.source, {
            requireCover: pin.kind === 'hero',
            limit: EDITORIAL_PIN_MAX_TRACKS,
          }),
        );
      }
    }
    const trackIds = [
      ...new Set([
        ...live.flatMap((pin) =>
          pin.source.type === 'tracks' ? pin.source.trackIds : [],
        ),
        ...[...resolved.values()].flat(),
      ]),
    ];
    const records =
      await this.homeRepository.findCompletedTracksByIds(trackIds);
    const tracksById = new Map(
      records.map((record) => [
        record.id,
        toHomeTrack(toHomeCandidate(record)),
      ]),
    );
    const pins = live.flatMap((pin) => {
      const overlayPin = toOverlayPin(
        pin,
        viewer.locale,
        tracksById,
        resolved.get(pin.id) ?? [],
      );
      return overlayPin ? [overlayPin] : [];
    });
    return applyEditorialPins(rows, pins, viewer.audience ?? 'public');
  }
}

const targetsViewer = (pin: EditorialPin, viewer: Viewer): boolean =>
  (pin.locale === null || pin.locale === viewer.locale) &&
  (pin.audience === 'everyone' || !viewer.signedIn);

/** A live pin as the overlay places it, or nothing when it has no title here. */
const toOverlayPin = (
  pin: EditorialPin,
  locale: Locale,
  tracksById: ReadonlyMap<string, HomeTrack>,
  resolvedIds: string[],
): OverlayPin | undefined => {
  const title = pin.titles[locale];
  if (title === undefined) {
    return undefined;
  }
  const pinnedTitle: HomeRowTitle = {
    key: PINNED_ROW_TITLE_KEY,
    params: { title },
  };
  const orderedIds =
    pin.source.type === 'tracks' ? pin.source.trackIds : resolvedIds;
  return {
    id: pin.id,
    kind: pin.kind,
    position: pin.position,
    priority: pin.priority,
    createdAt: Date.parse(pin.createdAt),
    sponsored: pin.sponsored,
    title: pinnedTitle,
    tracks: orderedIds.flatMap((trackId) => {
      const track = tracksById.get(trackId);
      return track ? [track] : [];
    }),
  };
};
