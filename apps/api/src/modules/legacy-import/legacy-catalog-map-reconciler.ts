import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { LegacyCatalogEntity } from './legacy-catalog-entities.js';
import { LegacyCatalogMapIdentityService } from './legacy-catalog-map-identity.service.js';
import type { LegacyCatalogMapInputs } from './legacy-catalog-map-input.service.js';
import {
  type LegacyMapDecision,
  matchLegacyAlbum,
  matchLegacyArtist,
} from './legacy-catalog-map-matching.js';
import {
  addPending,
  addUnresolved,
  type EntityMapReport,
  emptyReport,
  namesAgree,
  pendingReason,
} from './legacy-catalog-map-report.js';
import { legacyTrackSchema } from './legacy-recording.js';

const frozenLegacyTrackSchema = legacyTrackSchema.extend({
  createdAt: z.coerce.date(),
});

type PlanWithMetadata = LegacyCatalogMapInputs['plans'][number];
type EntityOccurrence = {
  name: string;
  trackId: string | null;
  metadataStatus: string | null;
  skipped: boolean;
  sourceOnly: boolean;
};
/** Resolves source entities against identities persisted by the metadata worker. */
@Injectable()
export class LegacyCatalogMapReconciler {
  constructor(private readonly identities: LegacyCatalogMapIdentityService) {}

  async reconcile(inputs: LegacyCatalogMapInputs) {
    const { plans } = inputs;
    const { artists, albums } = this.collectEntities(
      plans,
      inputs.artists,
      inputs.albums,
    );
    const trackIds = this.trackIds(plans);
    const [artistEvidence, albumEvidence] = await Promise.all([
      this.identities.findArtistEvidence(trackIds),
      this.identities.findAlbumEvidence(trackIds),
    ]);
    const readyTracks = new Set(
      plans
        .filter((plan) => plan.trackId && plan.metadataStatus === 'completed')
        .map((plan) => plan.trackId)
        .filter((id): id is string => id !== null),
    );
    return {
      artists: await this.reconcileArtists(
        artists,
        artistEvidence,
        readyTracks,
      ),
      albums: await this.reconcileAlbums(
        albums,
        albumEvidence,
        artistEvidence,
        readyTracks,
      ),
    };
  }

  private collectEntities(
    plans: PlanWithMetadata[],
    sourceArtists: LegacyCatalogEntity[],
    sourceAlbums: LegacyCatalogEntity[],
  ) {
    const artists = new Map<string, EntityOccurrence[]>();
    const albums = new Map<string, EntityOccurrence[]>();
    for (const artist of sourceArtists) {
      addOccurrence(artists, artist.id, {
        name: artist.name,
        trackId: null,
        metadataStatus: null,
        skipped: false,
        sourceOnly: true,
      });
    }
    for (const album of sourceAlbums) {
      addOccurrence(albums, album.id, {
        name: album.name,
        trackId: null,
        metadataStatus: null,
        skipped: false,
        sourceOnly: true,
      });
    }
    for (const plan of plans) {
      const parsed = frozenLegacyTrackSchema.safeParse(plan.source);
      if (!parsed.success) throw new Error('INVALID_FROZEN_LEGACY_TRACK');
      for (const artist of parsed.data.artists) {
        addOccurrence(artists, artist.id, {
          name: artist.name,
          trackId: plan.trackId,
          metadataStatus: plan.metadataStatus,
          skipped: plan.status === 'skipped',
          sourceOnly: false,
        });
      }
      if (parsed.data.albumId && parsed.data.albumName) {
        addOccurrence(albums, parsed.data.albumId, {
          name: parsed.data.albumName,
          trackId: plan.trackId,
          metadataStatus: plan.metadataStatus,
          skipped: plan.status === 'skipped',
          sourceOnly: false,
        });
      }
    }
    return { artists, albums };
  }

  private trackIds(plans: PlanWithMetadata[]): string[] {
    return [
      ...new Set(
        plans
          .map((plan) => plan.trackId)
          .filter((id): id is string => id !== null),
      ),
    ];
  }

  private async reconcileArtists(
    entries: Map<string, EntityOccurrence[]>,
    evidence: Awaited<
      ReturnType<LegacyCatalogMapIdentityService['findArtistEvidence']>
    >,
    readyTracks: Set<string>,
  ): Promise<EntityMapReport> {
    const report = emptyReport();
    for (const [legacyId, occurrences] of entries) {
      const planned = occurrences.filter(
        (item) => !item.skipped && !item.sourceOnly,
      );
      if (planned.length === 0) {
        addUnresolved(
          report,
          legacyId,
          occurrences.some((item) => item.skipped)
            ? 'recording-plan-skipped'
            : 'no-planned-track',
        );
        continue;
      }
      if (!this.allReady(planned, readyTracks)) {
        addPending(report, legacyId, pendingReason(planned));
        continue;
      }
      if (!namesAgree(occurrences.filter((item) => !item.skipped))) {
        addUnresolved(report, legacyId, 'legacy-name-conflict');
        continue;
      }
      const decision = matchLegacyArtist(
        planned[0]?.name ?? '',
        planned.map((item) =>
          evidence
            .filter((entry) => entry.trackId === item.trackId)
            .map(({ mbid, creditedName }) => ({
              mbid,
              creditedNames: [creditedName],
            })),
        ),
      );
      await this.persistArtist(report, legacyId, decision);
    }
    return report;
  }

  private async reconcileAlbums(
    entries: Map<string, EntityOccurrence[]>,
    evidence: Awaited<
      ReturnType<LegacyCatalogMapIdentityService['findAlbumEvidence']>
    >,
    artistEvidence: Awaited<
      ReturnType<LegacyCatalogMapIdentityService['findArtistEvidence']>
    >,
    readyTracks: Set<string>,
  ): Promise<EntityMapReport> {
    const report = emptyReport();
    for (const [legacyId, occurrences] of entries) {
      const planned = occurrences.filter(
        (item) => !item.skipped && !item.sourceOnly,
      );
      if (planned.length === 0) {
        addUnresolved(
          report,
          legacyId,
          occurrences.some((item) => item.skipped)
            ? 'recording-plan-skipped'
            : 'no-planned-track',
        );
        continue;
      }
      if (!this.allReady(planned, readyTracks)) {
        addPending(report, legacyId, pendingReason(planned));
        continue;
      }
      if (!namesAgree(occurrences.filter((item) => !item.skipped))) {
        addUnresolved(report, legacyId, 'legacy-name-conflict');
        continue;
      }
      const decision = matchLegacyAlbum(
        planned[0]?.name ?? '',
        planned.map((item) => {
          const trackId = item.trackId;
          return {
            albums: evidence.filter((entry) => entry.trackId === trackId),
            recordingArtistMbids: artistEvidence
              .filter((entry) => entry.trackId === trackId)
              .map((entry) => entry.mbid),
          };
        }),
      );
      await this.persistAlbum(report, legacyId, decision);
    }
    return report;
  }

  private allReady(
    occurrences: EntityOccurrence[],
    readyTracks: Set<string>,
  ): boolean {
    return occurrences.every(
      (item) => item.trackId && readyTracks.has(item.trackId),
    );
  }

  private async persistArtist(
    report: EntityMapReport,
    legacyId: string,
    decision: LegacyMapDecision,
  ): Promise<void> {
    if (decision.status === 'unresolved') {
      addUnresolved(report, legacyId, decision.reason);
      return;
    }
    const artistId = await this.identities.findArtistId(decision.mbid);
    if (!artistId) {
      addPending(report, legacyId, 'metadata-entity-not-imported');
      return;
    }
    await this.identities.mapArtist(legacyId, artistId);
    report.mapped += 1;
  }

  private async persistAlbum(
    report: EntityMapReport,
    legacyId: string,
    decision: LegacyMapDecision,
  ): Promise<void> {
    if (decision.status === 'unresolved') {
      addUnresolved(report, legacyId, decision.reason);
      return;
    }
    const albumId = await this.identities.findAlbumId(decision.mbid);
    if (!albumId) {
      addPending(report, legacyId, 'metadata-entity-not-imported');
      return;
    }
    await this.identities.mapAlbum(legacyId, albumId);
    report.mapped += 1;
  }
}

const addOccurrence = (
  entries: Map<string, EntityOccurrence[]>,
  key: string,
  occurrence: EntityOccurrence,
): void => {
  const current = entries.get(key) ?? [];
  current.push(occurrence);
  entries.set(key, current);
};
