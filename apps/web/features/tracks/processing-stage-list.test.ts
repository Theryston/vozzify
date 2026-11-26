import { expect, it } from 'vitest';

import { stepPosition, stepStates } from './processing-steps';

const stages = ['EXTRACTING_VOCALS', 'DETECTING_NOTES'] as const;

it('counts only the stages that run for an uploaded recording', () => {
  expect(stepPosition('EXTRACTING_VOCALS', null, stages)).toEqual({
    number: 1,
    total: 2,
  });
  expect(stepStates('DETECTING_NOTES', null, stages)).toEqual([
    { step: 'EXTRACTING_VOCALS', state: 'done' },
    { step: 'DETECTING_NOTES', state: 'current' },
  ]);
});

it('does not mark a stage when the failed step was not part of the run', () => {
  expect(stepPosition('FAILED', 'DOWNLOADING_AUDIO', stages)).toBeNull();
  expect(stepStates('FAILED', 'DOWNLOADING_AUDIO', stages)).toEqual([
    { step: 'EXTRACTING_VOCALS', state: 'pending' },
    { step: 'DETECTING_NOTES', state: 'pending' },
  ]);
});
