import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadLegacyCatalogMapEnv } from '../../config/env.js';
import { LegacyCatalogMapModule } from './legacy-catalog-map.module.js';
import { LegacyCatalogMapService } from './legacy-catalog-map.service.js';

/** Runs the destination-only catalog-map reconciliation command. */
export const runLegacyCatalogMap = async (args: string[]): Promise<boolean> => {
  const logger = new Logger('LegacyCatalogMap');
  if (args.length !== 1 || args[0] !== '--import-legacy-catalog-maps') {
    logger.error('Use --import-legacy-catalog-maps to reconcile legacy IDs.');
    return false;
  }
  try {
    loadLegacyCatalogMapEnv();
    const app = await NestFactory.createApplicationContext(
      LegacyCatalogMapModule,
      { abortOnError: false },
    );
    try {
      const result = await app.get(LegacyCatalogMapService).reconcile();
      logger.log({ action: 'reconcile', ...result });
      return true;
    } finally {
      await app.close();
    }
  } catch {
    logger.error(
      'Catalog-map reconciliation failed; check the completed recording plan, destination database, Redis metadata jobs, and retryable metadata work.',
    );
    return false;
  }
};
