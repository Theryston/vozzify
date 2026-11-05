import {
  ConsoleLogger,
  type INestApplicationContext,
  type Type,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mbidSchema } from '@vozzify/contracts';
import { loadLegacyImportEnv } from '../../config/env.js';
import { LegacyCatalogMapModule } from './legacy-catalog-map.module.js';
import { LegacyCatalogMapService } from './legacy-catalog-map.service.js';
import { LegacyCutoverReportModule } from './legacy-cutover-report.module.js';
import { LegacyCutoverReportService } from './legacy-cutover-report.service.js';
import {
  runLegacyPersonalDataImport,
  runLegacyRecordingPlan,
} from './legacy-import-command.js';
import { LegacyProcessingBacklogModule } from './legacy-processing-backlog.module.js';
import { LegacyProcessingBacklogService } from './legacy-processing-backlog.service.js';
import { LegacyRecordingGroupModule } from './legacy-recording-group.module.js';
import { LegacyRecordingGroupService } from './legacy-recording-group.service.js';
import { runLegacyRelationshipImport } from './legacy-relationship-import.command.js';

// Separate contexts preserve each stage's environment and worker-free lifecycle.
const context = async <T>(
  module: Type,
  run: (app: INestApplicationContext) => Promise<T>,
) => {
  const app = await NestFactory.createApplicationContext(module, {
    abortOnError: false,
    logger: new ConsoleLogger({
      json: loadLegacyImportEnv().NODE_ENV === 'production',
    }),
  });
  try {
    return await run(app);
  } finally {
    await app.close();
  }
};

export const inspectCutover = async () => {
  const initial = await context(LegacyCutoverReportModule, (app) =>
    app.get(LegacyCutoverReportService).inspect(),
  );
  if (!initial.planComplete || !initial.identityComplete)
    return { ...initial, reconciliationErrors: [] };
  try {
    const maps = await context(LegacyCatalogMapModule, (app) =>
      app.get(LegacyCatalogMapService).reconcile(),
    );
    const report = await context(LegacyCutoverReportModule, (app) =>
      app.get(LegacyCutoverReportService).inspect(maps),
    );
    return { ...report, reconciliationErrors: [] };
  } catch {
    return {
      ...initial,
      finished: false,
      reconciliationErrors: ['CATALOG_MAP_RECONCILIATION_PENDING'],
    };
  }
};

export const prepareCutover = async (): Promise<boolean> => {
  if (!(await runLegacyPersonalDataImport())) return false;
  if (!(await runLegacyRecordingPlan())) return false;
  const report = await context(LegacyCutoverReportModule, (app) =>
    app.get(LegacyCutoverReportService).inspect(),
  );
  if (report.source.errors.length > 0) return false;
  const recordings = new Set(
    report.tracks.flatMap((track) =>
      track.status === 'planned' && track.recordingMbid
        ? [track.recordingMbid]
        : [],
    ),
  );
  await context(LegacyRecordingGroupModule, async (app) => {
    for (const recording of recordings)
      await app
        .get(LegacyRecordingGroupService)
        .prepare(mbidSchema.parse(recording));
  });
  return runLegacyRelationshipImport();
};

export const continueCutover = async (): Promise<void> => {
  await context(LegacyProcessingBacklogModule, (app) =>
    app.get(LegacyProcessingBacklogService).runCycle(),
  );
};
