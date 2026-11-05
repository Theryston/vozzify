import { Injectable, Logger } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { LegacyImportRepository } from './legacy-import.repository.js';
import {
  LegacySourceRepository,
  type LegacySourceSnapshot,
} from './legacy-source.repository.js';
import type { LegacyUser } from './legacy-user.js';

export type LegacyImportReport = {
  status: 'complete' | 'incomplete';
  sourceUsers: number;
  sourceAccounts: number;
  importedUsers: number;
  importedAccounts: number;
  errors: string[];
};

@Injectable()
export class LegacyImportService {
  private readonly logger = new Logger(LegacyImportService.name);

  constructor(
    private readonly repository: LegacyImportRepository,
    private readonly source: LegacySourceRepository,
  ) {}

  async run(): Promise<LegacyImportReport> {
    const report: LegacyImportReport = {
      status: 'incomplete',
      sourceUsers: 0,
      sourceAccounts: 0,
      importedUsers: 0,
      importedAccounts: 0,
      errors: [],
    };
    try {
      await this.repository.locked(async () => {
        const progress = await this.repository.resume();
        report.importedUsers = progress?.importedUsers ?? 0;
        report.importedAccounts = progress?.importedAccounts ?? 0;
        await this.source.snapshot((snapshot) =>
          this.importSnapshot(snapshot, report),
        );
      });
    } catch (error) {
      report.status = 'incomplete';
      // Driver errors can contain SQL parameters, URLs and credentials.
      const safeCodes = new Set([
        'IMPORT_ALREADY_RUNNING',
        'SOURCE_CHANGED',
        'DESTINATION_NOT_EMPTY',
        'LEGACY_DATABASE_URL_REQUIRED',
      ]);
      report.errors.push(
        error instanceof Error && safeCodes.has(error.message)
          ? error.message
          : 'USER_IMPORT_FAILED',
      );
    }
    this.logger.log(JSON.stringify(report));
    return report;
  }

  private async importSnapshot(
    source: LegacySourceSnapshot,
    report: LegacyImportReport,
  ): Promise<void> {
    const validation = await source.validate();
    report.sourceUsers = validation.users;
    report.sourceAccounts = validation.accounts;
    report.errors = validation.errors;
    if (report.errors.length > 0) return;
    const progress = await this.repository.prepare(validation.digest);
    report.importedUsers = progress.importedUsers;
    report.importedAccounts = progress.importedAccounts;
    let cursor = progress.lastUserId;
    for (;;) {
      const page = await source.page(cursor);
      if (page.length === 0) break;
      for (const user of page) {
        await this.importUser(user);
        report.importedUsers++;
        report.importedAccounts +=
          user.accounts.length + Number(user.password !== null);
        cursor = user.id;
        this.logger.log(
          JSON.stringify({
            stage: 'users',
            status: 'incomplete',
            importedUsers: report.importedUsers,
            importedAccounts: report.importedAccounts,
          }),
        );
      }
    }
    await this.repository.complete();
    report.status = 'complete';
  }
  @Transactional()
  private async importUser(user: LegacyUser): Promise<void> {
    await this.repository.importUser(user);
  }
}
