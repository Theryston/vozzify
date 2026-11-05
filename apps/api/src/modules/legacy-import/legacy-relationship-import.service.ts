import { Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { LegacyImportRepository } from './legacy-import.repository.js';
import { LegacyRelationshipDomainService } from './legacy-relationship-domain.service.js';
import { LegacyRelationshipImportRepository } from './legacy-relationship-import.repository.js';
import type { LegacyFavorite, LegacyView } from './legacy-relationships.js';
import {
  LegacySourceRepository,
  type LegacySourceSnapshot,
} from './legacy-source.repository.js';
import { relationshipSourceFingerprint } from './legacy-source-fingerprints.js';

export type LegacyRelationshipImportReport = {
  status: 'complete' | 'incomplete';
  acceptedFavorites: number;
  importedFavorites: number;
  deduplicatedFavorites: number;
  importedViews: number;
  skippedFavorites: number;
  skippedViews: number;
  skippedLegacyTracks: Array<{
    legacyTrackId: string;
    favorites: number;
    views: number;
  }>;
  errors: string[];
};

const EXPECTED_ERRORS = new Set([
  'IMPORT_ALREADY_RUNNING',
  'LEGACY_DATABASE_URL_REQUIRED',
  'RELATIONSHIP_MAP_PENDING',
  'RELATIONSHIP_SOURCE_CHANGED',
  'RECORDING_PLAN_INCOMPLETE',
  'SOURCE_CHANGED',
]);

@Injectable()
export class LegacyRelationshipImportService {
  private readonly logger = new Logger(LegacyRelationshipImportService.name);

  constructor(
    private readonly lock: LegacyImportRepository,
    private readonly progress: LegacyRelationshipImportRepository,
    private readonly source: LegacySourceRepository,
    private readonly domain: LegacyRelationshipDomainService,
  ) {}

  async run(): Promise<LegacyRelationshipImportReport> {
    const report: LegacyRelationshipImportReport = {
      status: 'incomplete',
      acceptedFavorites: 0,
      importedFavorites: 0,
      deduplicatedFavorites: 0,
      importedViews: 0,
      skippedFavorites: 0,
      skippedViews: 0,
      skippedLegacyTracks: [],
      errors: [],
    };
    try {
      await this.lock.locked(() =>
        this.source.snapshot((snapshot) =>
          this.importSnapshot(snapshot, report),
        ),
      );
    } catch (error) {
      report.errors.push(
        error instanceof Error && EXPECTED_ERRORS.has(error.message)
          ? error.message
          : 'RELATIONSHIP_IMPORT_FAILED',
      );
    }
    this.logger.log(JSON.stringify(report));
    return report;
  }

  private async importSnapshot(
    source: LegacySourceSnapshot,
    report: LegacyRelationshipImportReport,
  ): Promise<void> {
    const recordingSource = await source.validateRecordingSource();
    await this.progress.assertPlanComplete(recordingSource.digest);
    const sourceDigest = await this.relationshipDigest(source);
    const saved = await this.progress.prepare(sourceDigest);
    Object.assign(report, {
      acceptedFavorites: saved.acceptedFavorites,
      importedFavorites: saved.importedFavorites,
      deduplicatedFavorites: saved.deduplicatedFavorites,
      importedViews: saved.importedViews,
      skippedFavorites: saved.skippedFavorites,
      skippedViews: saved.skippedViews,
    });
    if (saved.status === 'complete') {
      report.status = 'complete';
      report.skippedLegacyTracks = await this.progress.skippedTracks();
      return;
    }
    await this.importFavorites(source, saved.lastFavoriteId, report);
    await this.refreshFavoritePages(source);
    await this.importViews(source, report);
    await this.refreshViewScores(source);
    await this.progress.complete();
    const skipped = await this.progress.skippedTracks();
    report.skippedLegacyTracks = skipped;
    report.status = 'complete';
  }

  private async refreshFavoritePages(
    source: LegacySourceSnapshot,
  ): Promise<void> {
    const saved = await this.progress.find();
    if (!saved) throw new Error('RELATIONSHIP_PROGRESS_NOT_FOUND');
    let cursor = saved.lastRefreshedFavoriteId;
    for (;;) {
      const page = await source.favoritePage(cursor);
      if (page.length === 0) return;
      await this.domain.refreshFavorites(page);
      const lastId = page.at(-1)?.id;
      if (!lastId) throw new Error('FAVORITE_PAGE_EMPTY');
      await this.progress.commitRefreshedFavoritePage(lastId);
      cursor = lastId;
    }
  }

  private async importFavorites(
    source: LegacySourceSnapshot,
    savedCursor: string | null,
    report: LegacyRelationshipImportReport,
  ): Promise<void> {
    let cursor = savedCursor;
    for (;;) {
      const page = await source.favoritePage(cursor);
      if (page.length === 0) return;
      const imported = await this.importFavoritePage(page);
      report.acceptedFavorites += imported.accepted;
      report.importedFavorites += imported.imported;
      report.deduplicatedFavorites += imported.deduplicated;
      report.skippedFavorites += imported.skipped;
      cursor = page.at(-1)?.id ?? cursor;
    }
  }

  @Transactional()
  private async importFavoritePage(page: LegacyFavorite[]): Promise<{
    accepted: number;
    imported: number;
    deduplicated: number;
    skipped: number;
  }> {
    const counts = await this.domain.importFavorites(page);
    const lastId = page.at(-1)?.id;
    if (!lastId) throw new Error('FAVORITE_PAGE_EMPTY');
    await this.progress.commitFavoritePage(lastId, counts);
    return counts;
  }

  private async importViews(
    source: LegacySourceSnapshot,
    report: LegacyRelationshipImportReport,
  ): Promise<void> {
    const saved = await this.progress.find();
    if (!saved) throw new Error('RELATIONSHIP_PROGRESS_NOT_FOUND');
    let cursor = saved.lastViewId;
    for (;;) {
      const page = await source.viewPage(cursor);
      if (page.length === 0) return;
      const imported = await this.importViewPage(page);
      report.importedViews += imported.imported;
      report.skippedViews += imported.skipped;
      cursor = page.at(-1)?.id ?? cursor;
    }
  }

  @Transactional()
  private async importViewPage(
    page: LegacyView[],
  ): Promise<{ imported: number; skipped: number }> {
    const counts = await this.domain.importViews(page);
    const lastId = page.at(-1)?.id;
    if (!lastId) throw new Error('VIEW_PAGE_EMPTY');
    await this.progress.commitViewPage(lastId, counts);
    return counts;
  }

  private async refreshViewScores(source: LegacySourceSnapshot): Promise<void> {
    const saved = await this.progress.find();
    if (!saved) throw new Error('RELATIONSHIP_PROGRESS_NOT_FOUND');
    let cursor = saved.lastRefreshedViewId;
    for (;;) {
      const page = await source.viewPage(cursor);
      if (page.length === 0) return;
      await this.domain.refreshViews(page);
      const lastId = page.at(-1)?.id;
      if (!lastId) throw new Error('VIEW_PAGE_EMPTY');
      await this.progress.commitRefreshedViewPage(lastId);
      cursor = lastId;
    }
  }

  private async relationshipDigest(source: LegacySourceSnapshot) {
    return (await relationshipSourceFingerprint(source)).digest;
  }
}
