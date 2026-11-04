import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadLegacyImportEnv } from '../../config/env.js';
import { LegacyImportModule } from './legacy-import.module.js';
import { LegacyImportService } from './legacy-import.service.js';

export const runLegacyUserImport = async (): Promise<boolean> => {
  const logger = new Logger('LegacyUserImport');
  try {
    const env = loadLegacyImportEnv();
    const app = await NestFactory.createApplicationContext(LegacyImportModule, {
      logger: new ConsoleLogger({ json: env.NODE_ENV === 'production' }),
      abortOnError: false,
    });
    try {
      const report = await app.get(LegacyImportService).run();
      return report.status === 'complete';
    } finally {
      await app.close();
    }
  } catch {
    logger.error(
      'User import incomplete: check DATABASE_URL and LEGACY_DATABASE_URL and apply destination migrations.',
    );
    return false;
  }
};
