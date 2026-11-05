import { Logger } from '@nestjs/common';
import {
  continueCutover,
  inspectCutover,
  prepareCutover,
} from './legacy-cutover-stages.js';

export const runLegacyCutover = async (args: string[]): Promise<boolean> => {
  const logger = new Logger('LegacyCutover');
  if (
    args.length !== 2 ||
    args[0] !== '--legacy-cutover' ||
    !['prepare', 'status', 'continue'].includes(args[1] ?? '')
  ) {
    logger.error('Use --legacy-cutover prepare|status|continue.');
    return false;
  }
  const action = args[1];
  const errors: string[] = [];
  try {
    if (action === 'prepare' && !(await prepareCutover()))
      errors.push('CUTOVER_PREPARATION_INCOMPLETE');
    if (action === 'continue') {
      const current = await inspectCutover();
      if (!current.ready) errors.push('CUTOVER_NOT_READY');
      else await continueCutover();
    }
  } catch {
    errors.push('CUTOVER_STAGE_FAILED');
  }
  try {
    const report = await inspectCutover();
    logger.log(JSON.stringify({ cutover: true, action, ...report, errors }));
    return errors.length === 0 && (action === 'status' || report.ready);
  } catch {
    logger.error(
      JSON.stringify({
        cutover: true,
        action,
        ready: false,
        finished: false,
        errors: [...errors, 'CUTOVER_REPORT_UNAVAILABLE'],
      }),
    );
    return false;
  }
};
