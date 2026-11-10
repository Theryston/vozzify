import { Inject, Injectable, Optional } from '@nestjs/common';
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
import type { HomeCompositionCandidateRow } from './home-composition-candidates.js';
import { toHomeTrack } from './home-feed-builder.service.js';
import { genreArtistKeys } from './home-genre-overlay.js';
import { composePersonalVisitRows } from './home-personal-visit-composer.js';
import { applyEditorialPins, type OverlayPin } from './home-pin-overlay.js';
import { HomePublicOverlayCache } from './home-public-overlay-cache.js';
import { composePublicVisitRows } from './home-public-visit-composer.js';
import { composePublicVisitRowsWithRefill } from './home-public-visit-refill.js';
import {
  HOME_ROW_SOURCES,
  type HomeRowSource,
  toHomeCandidate,
} from './home-row-sources.js';
import { HOME_MAX_ROWS } from './home-rules.js';

/**
 * The title key of a pinned row. Its text is the admin's, in the locale of the
 * feed, sent as the `title` parameter: the web renders it as `{title}`.
 */
export const PINNED_ROW_TITLE_KEY = 'home.rows.pinned';

type Viewer = {
  locale: Locale;
  signedIn: boolean;
  audience?: 'public' | 'personal';
  sourceVersion?: string;
  compositionAudience?: 'public' | 'personal';
  allowSourceRefill?: boolean;
  genreArtists?: ReadonlyMap<string, readonly string[]>;
};

export type HomePinOverlayOptions = Viewer & {
  candidates?: HomeCompositionCandidateRow[];
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
    @Optional()
    @Inject(HOME_ROW_SOURCES)
    private readonly sources?: HomeRowSource[],
    @Optional() private readonly publicOverlays?: HomePublicOverlayCache,
  ) {}

  async apply(
    rows: HomeRow[],
    viewer: Viewer,
    candidates?: HomeCompositionCandidateRow[],
  ): Promise<HomeRow[]> {
    const live = await this.pins.findLivePins(viewer);
    return this.applyPins(rows, viewer, live, candidates);
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
    candidates?: HomeCompositionCandidateRow[],
  ): Promise<HomeRow[]> {
    if (
      live.length === 0 &&
      rows.length <= HOME_MAX_ROWS &&
      (viewer.audience ?? 'public') === 'public'
    ) {
      const placed = applyEditorialPins(
        rows,
        [],
        'public',
        viewer.genreArtists ?? genreArtistKeys(candidates),
      );
      return placed.length === rows.length &&
        placed.every((row, index) => row === rows[index])
        ? rows
        : placed;
    }
    const overlayPins =
      live.length === 0 ? [] : await this.resolvePins(live, viewer);
    if (viewer.audience === 'personal') {
      // Public-derived private visits keep public ranking and User-specific
      // social Rows, so they must never use the shared public overlay cache.
      if (viewer.compositionAudience === 'public' && candidates) {
        return composePublicVisitRows(
          rows,
          candidates,
          overlayPins,
          'personal',
        );
      }
      return candidates
        ? composePersonalVisitRows(rows, candidates, overlayPins)
        : applyEditorialPins(
            rows,
            overlayPins,
            'personal',
            viewer.genreArtists,
          );
    }
    return this.publicRows(rows, viewer, overlayPins, candidates);
  }

  private async publicRows(
    rows: HomeRow[],
    viewer: Viewer,
    pins: OverlayPin[],
    candidates?: HomeCompositionCandidateRow[],
  ): Promise<HomeRow[]> {
    if (candidates === undefined) {
      return applyEditorialPins(rows, pins, 'public', viewer.genreArtists);
    }
    const input = {
      rows,
      candidates,
      pins,
      locale: viewer.locale,
      sourceVersion: viewer.sourceVersion,
    };
    if (viewer.allowSourceRefill === false) {
      return (
        (await this.publicOverlays?.read(input)) ??
        composePublicVisitRows(rows, candidates, pins)
      );
    }
    const compose = () =>
      composePublicVisitRowsWithRefill({
        rows,
        candidateRows: candidates,
        pins,
        sources: this.sources ?? [],
        locale: viewer.locale,
      });
    return this.publicOverlays && candidates
      ? this.publicOverlays.resolve(input, compose)
      : compose();
  }

  private async resolvePins(
    live: EditorialPin[],
    viewer: Viewer,
  ): Promise<OverlayPin[]> {
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
    return live.flatMap((pin) => {
      const overlayPin = toOverlayPin(
        pin,
        viewer.locale,
        tracksById,
        resolved.get(pin.id) ?? [],
      );
      return overlayPin ? [overlayPin] : [];
    });
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
