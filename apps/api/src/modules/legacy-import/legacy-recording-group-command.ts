import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mbidSchema } from '@vozzify/contracts';
import { loadEnv } from '../../config/env.js';
import { createAppLogger } from '../../setup-app.js';
import { LegacyRecordingGroupModule } from './legacy-recording-group.module.js';
import { LegacyRecordingGroupService } from './legacy-recording-group.service.js';

const actions = {
  '--prepare-legacy-recording': 'prepare',
  '--start-legacy-recording': 'start',
  '--retry-legacy-recording': 'retry',
} as const;

const parseCommand = (args: string[]) => {
  const [flag, value] = args;
  const recordingMbid = mbidSchema.safeParse(value);
  if (
    args.length !== 2 ||
    flag === undefined ||
    !(flag in actions) ||
    !recordingMbid.success
  ) {
    throw new Error('INVALID_LEGACY_RECORDING_COMMAND');
  }
  const action = Object.entries(actions).find(([key]) => key === flag)?.[1];
  if (action === undefined) throw new Error('INVALID_LEGACY_RECORDING_COMMAND');
  return { action, recordingMbid: recordingMbid.data };
};

/** Receives only command arguments, without the Node executable or entrypoint. */
export const runLegacyRecordingGroup = async (
  args: string[],
): Promise<boolean> => {
  const logger = new Logger('LegacyRecordingGroup');
  try {
    const { action, recordingMbid } = parseCommand(args);
    const env = loadEnv();
    const app = await NestFactory.createApplicationContext(
      LegacyRecordingGroupModule,
      { abortOnError: false, logger: createAppLogger(env) },
    );
    try {
      const result = await app
        .get(LegacyRecordingGroupService)
        [action](recordingMbid);
      logger.log({ action, recordingMbid, result: result ?? 'accepted' });
      return true;
    } finally {
      await app.close();
    }
  } catch {
    logger.error(
      'Recording group command failed: use one prepare/start/retry flag followed by a Recording MBID; check the completed plan, destination migrations and API configuration.',
    );
    return false;
  }
};
