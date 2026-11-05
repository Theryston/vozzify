import { beforeEach, expect, it, vi } from 'vitest';
import {
  autoGuideMelody,
  loadSingingAids,
  saveSingingAids,
  singingAidsStore,
} from './singing-aids-store';

let saved: string | null = null;
beforeEach(() => {
  saved = null;
  singingAidsStore.setState({
    countIn: true,
    guideMelody: false,
    guideMelodyManual: false,
    offset: 0,
  });
  vi.stubGlobal('localStorage', {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  });
});
it('keeps count-in on and guide melody off until the visitor changes them', () => {
  loadSingingAids();
  expect(singingAidsStore.getState()).toEqual({
    countIn: true,
    guideMelody: false,
    guideMelodyManual: false,
    offset: 0,
  });
  saveSingingAids({
    countIn: false,
    guideMelody: true,
    guideMelodyManual: true,
    offset: -0.12,
  });
  singingAidsStore.setState({
    countIn: true,
    guideMelody: false,
    guideMelodyManual: false,
    offset: 0,
  });
  loadSingingAids();
  expect(singingAidsStore.getState()).toEqual({
    countIn: false,
    guideMelody: true,
    guideMelodyManual: true,
    offset: -0.12,
  });
});
it.each([
  'null',
  '[]',
  '{}',
  '{"offset":5,"countIn":"false","guideMelody":"true"}',
  '{bad',
])('ignores invalid stored preferences: %s', (value) => {
  saved = value;
  loadSingingAids();
  expect(singingAidsStore.getState()).toEqual({
    countIn: true,
    guideMelody: false,
    guideMelodyManual: false,
    offset: 0,
  });
});
it('still applies controls with blocked storage', () => {
  vi.stubGlobal('localStorage', {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  });
  expect(() => loadSingingAids()).not.toThrow();
  saveSingingAids({ guideMelody: true });
  expect(singingAidsStore.getState().guideMelody).toBe(true);
});
it('auto guide follows the transposition until the visitor picks by hand', () => {
  autoGuideMelody(true);
  expect(singingAidsStore.getState().guideMelody).toBe(true);
  autoGuideMelody(false);
  expect(singingAidsStore.getState().guideMelody).toBe(false);
});
it('auto guide never overrides a hand-picked guide, on or off', () => {
  saveSingingAids({ guideMelody: true, guideMelodyManual: true });
  autoGuideMelody(false);
  expect(singingAidsStore.getState().guideMelody).toBe(true);
  saveSingingAids({ guideMelody: false, guideMelodyManual: true });
  autoGuideMelody(true);
  expect(singingAidsStore.getState().guideMelody).toBe(false);
});
it('auto guide skips the store write when nothing changes', () => {
  autoGuideMelody(false);
  expect(saved).toBeNull();
});
it('keeps the hand-picked mark across reloads', () => {
  saveSingingAids({ guideMelody: true, guideMelodyManual: true });
  singingAidsStore.setState({
    countIn: true,
    guideMelody: false,
    guideMelodyManual: false,
    offset: 0,
  });
  loadSingingAids();
  expect(singingAidsStore.getState()).toEqual({
    countIn: true,
    guideMelody: true,
    guideMelodyManual: true,
    offset: 0,
  });
});
it('preserves a saved guide choice from before manual choices were tracked', () => {
  saved = '{"countIn":true,"guideMelody":true,"offset":0}';
  loadSingingAids();
  expect(singingAidsStore.getState()).toMatchObject({
    guideMelody: true,
    guideMelodyManual: true,
  });
  autoGuideMelody(false);
  expect(singingAidsStore.getState().guideMelody).toBe(true);
});

it('resets calibration from the old output-compensation model while preserving aids', () => {
  saved =
    '{"countIn":false,"guideMelody":true,"guideMelodyManual":true,"offset":0.25}';
  loadSingingAids();
  expect(singingAidsStore.getState()).toEqual({
    countIn: false,
    guideMelody: true,
    guideMelodyManual: true,
    offset: 0,
  });
});
