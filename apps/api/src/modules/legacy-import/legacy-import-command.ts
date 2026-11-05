import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  loadLegacyImportEnv,
  loadLegacyRecordingPlanEnv,
} from '../../config/env.js';
import { LegacyImportModule } from './legacy-import.module.js';
import { LegacyImportRepository } from './legacy-import.repository.js';
import { LegacyImportService } from './legacy-import.service.js';
import { LegacyPersonalImportService } from './legacy-personal-import.service.js';
import { LegacyRecordingPlanModule } from './legacy-recording-plan.module.js';
import { LegacyRecordingPlanService } from './legacy-recording-plan.service.js';
import { LegacySourceRepository } from './legacy-source.repository.js';

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

export const runLegacyPersonalDataImport = async (): Promise<boolean> => {
  const logger = new Logger('LegacyPersonalDataImport');
  try {
    const env = loadLegacyImportEnv();
    const app = await NestFactory.createApplicationContext(LegacyImportModule, {
      logger: new ConsoleLogger({ json: env.NODE_ENV === 'production' }),
      abortOnError: false,
    });
    try {
      const users = await app.get(LegacyImportService).run();
      if (users.status !== 'complete') return false;
      const report = await app.get(LegacyPersonalImportService).run();
      return report.status === 'complete';
    } finally {
      await app.close();
    }
  } catch {
    logger.error(
      'Personal data import incomplete: check DATABASE_URL and LEGACY_DATABASE_URL and apply destination migrations.',
    );
    return false;
  }
};

export const runLegacyRecordingPlan = async (): Promise<boolean> => {
  const logger = new Logger('LegacyRecordingPlan');
  try {
    const env = loadLegacyRecordingPlanEnv();
    const importer = await NestFactory.createApplicationContext(
      LegacyImportModule,
      {
        logger: new ConsoleLogger({ json: env.NODE_ENV === 'production' }),
        abortOnError: false,
      },
    );
    try {
      const users = await importer.get(LegacyImportService).run();
      if (users.status !== 'complete') return false;
    } finally {
      await importer.close();
    }
    const planner = await NestFactory.createApplicationContext(
      LegacyRecordingPlanModule,
      {
        logger: new ConsoleLogger({ json: env.NODE_ENV === 'production' }),
        abortOnError: false,
      },
    );
    try {
      const result = await planner
        .get(LegacyImportRepository)
        .locked(() =>
          planner
            .get(LegacySourceRepository)
            .snapshot((snapshot) =>
              planner.get(LegacyRecordingPlanService).run(snapshot),
            ),
        );
      return result.status === 'complete';
    } finally {
      await planner.close();
    }
  } catch {
    logger.error(
      'Recording plan incomplete: check DATABASE_URL, LEGACY_DATABASE_URL, Music catalog connection and applied destination migrations.',
    );
    return false;
  }
};
