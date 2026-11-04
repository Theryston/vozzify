import { Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { LegacyImportRepository } from './legacy-import.repository.js';
import type { LegacyPracticeDay, LegacyVisibility } from './legacy-personal.js';
import {
  LegacySourceRepository,
  type LegacySourceSnapshot,
} from './legacy-source.repository.js';
import { personalSourceFingerprint } from './legacy-source-fingerprints.js';

export type LegacyPersonalImportReport = {
  status: 'complete' | 'incomplete';
  importedPracticeDays: number;
  errors: string[];
};

const PERSONAL_IMPORT_ERRORS = new Set([
  'IMPORT_ALREADY_RUNNING',
  'PERSONAL_SOURCE_CHANGED',
  'LEGACY_DATABASE_URL_REQUIRED',
]);

@Injectable()
export class LegacyPersonalImportService {
  private readonly logger = new Logger(LegacyPersonalImportService.name);

  constructor(
    private readonly repository: LegacyImportRepository,
    private readonly source: LegacySourceRepository,
  ) {}

  async run(): Promise<LegacyPersonalImportReport> {
    const report: LegacyPersonalImportReport = {
      status: 'incomplete',
      importedPracticeDays: 0,
      errors: [],
    };
    try {
      await this.repository.locked(async () => {
        await this.source.snapshot((snapshot) =>
          this.importSnapshot(snapshot, report),
        );
      });
    } catch (error) {
      report.status = 'incomplete';
      report.errors.push(
        error instanceof Error && PERSONAL_IMPORT_ERRORS.has(error.message)
          ? error.message
          : 'PERSONAL_IMPORT_FAILED',
      );
    }
    this.logger.log(JSON.stringify(report));
    return report;
  }

  private async importSnapshot(
    source: LegacySourceSnapshot,
    report: LegacyPersonalImportReport,
  ): Promise<void> {
    const validation = await this.validate(source);
    const progress = await this.repository.personalProgress(validation.digest);
    report.importedPracticeDays = progress.importedPracticeDays;
    if (progress.status === 'complete') {
      report.status = 'complete';
      return;
    }
    let cursor = progress.lastPracticeId;
    for (;;) {
      const page = await source.practicePage(cursor);
      if (page.length === 0) break;
      for (const day of page) {
        await this.importPracticeDay(day);
        report.importedPracticeDays++;
        cursor = day.id;
      }
    }
    for (const [userId, values] of this.visibilityValues(validation.visibility))
      await this.repository.updateLegacyVisibility(userId, values);
    await this.repository.completePersonal();
    report.status = 'complete';
  }

  @Transactional()
  private async importPracticeDay(day: LegacyPracticeDay): Promise<void> {
    await this.repository.importPracticeDay(day);
  }

  private async validate(source: LegacySourceSnapshot): Promise<{
    digest: string;
    visibility: LegacyVisibility[];
  }> {
    return personalSourceFingerprint(source);
  }

  private visibilityValues(rows: LegacyVisibility[]): Map<
    string,
    {
      showSummarySection?: boolean;
      showPracticeHistorySection?: boolean;
      showFavoritesSection?: boolean;
    }
  > {
    const result = new Map<
      string,
      {
        showSummarySection?: boolean;
        showPracticeHistorySection?: boolean;
        showFavoritesSection?: boolean;
      }
    >();
    for (const row of rows) {
      const values = result.get(row.userId) ?? {};
      const shown = row.value === 'PUBLIC';
      switch (row.key.toUpperCase()) {
        case 'ADDED_TRACKS':
        case 'PROCESSING_TRACKS':
          values.showSummarySection =
            (values.showSummarySection ?? true) && shown;
          break;
        case 'FAVORITE_TRACKS':
          values.showFavoritesSection =
            (values.showFavoritesSection ?? true) && shown;
          break;
        default:
          // Legacy recent views have no current equivalent; retain privacy conservatively.
          if (!shown) {
            values.showSummarySection = false;
            values.showPracticeHistorySection = false;
            values.showFavoritesSection = false;
          }
      }
      result.set(row.userId, values);
    }
    return result;
  }
}
