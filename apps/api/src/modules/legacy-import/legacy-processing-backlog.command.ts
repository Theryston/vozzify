import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '../../config/env.js';
import { createAppLogger } from '../../setup-app.js';
import { LegacyProcessingBacklogModule } from './legacy-processing-backlog.module.js';
import { LegacyProcessingBacklogService } from './legacy-processing-backlog.service.js';

/** Runs the prepared migration backlog through the real Processing queues. */
export const runLegacyProcessingBacklog = async (): Promise<boolean> => {
  const logger = new Logger('LegacyProcessingBacklog');
  try {
    const env = loadEnv();
    const app = await NestFactory.createApplicationContext(
      LegacyProcessingBacklogModule,
      { abortOnError: false, logger: createAppLogger(env) },
    );
    try {
      await app.get(LegacyProcessingBacklogService).drain();
      return true;
    } finally {
      await app.close();
    }
  } catch {
    logger.error(
      'Legacy Processing backlog did not finish; inspect the destination database, queue and API configuration, then rerun this command to resume.',
    );
    return false;
  }
};
