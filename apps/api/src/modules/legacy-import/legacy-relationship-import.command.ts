import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv, loadLegacyImportEnv } from '../../config/env.js';
import { LegacyRelationshipImportModule } from './legacy-relationship-import.module.js';
import { LegacyRelationshipImportService } from './legacy-relationship-import.service.js';

export const runLegacyRelationshipImport = async (): Promise<boolean> => {
  const logger = new Logger('LegacyRelationshipImport');
  try {
    const env = loadEnv();
    loadLegacyImportEnv();
    const app = await NestFactory.createApplicationContext(
      LegacyRelationshipImportModule,
      {
        logger: new ConsoleLogger({ json: env.NODE_ENV === 'production' }),
        abortOnError: false,
      },
    );
    try {
      return (
        (await app.get(LegacyRelationshipImportService).run()).status ===
        'complete'
      );
    } finally {
      await app.close();
    }
  } catch {
    logger.error(
      'Relationship import incomplete: check DATABASE_URL, REDIS_URL, LEGACY_DATABASE_URL and apply destination migrations.',
    );
    return false;
  }
};
