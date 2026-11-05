import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

type Preferences = {
  countIn: boolean;
  guideMelody: boolean;
  /** The visitor picked the guide by hand: auto transpose leaves it alone. */
  guideMelodyManual: boolean;
  offset: number;
};
const defaults: Preferences = {
  countIn: true,
  guideMelody: false,
  guideMelodyManual: false,
  offset: 0,
};
const KEY = 'vozzify.singing-aids.v1';
const CALIBRATION_VERSION = 2;
export const singingAidsStore = createStore<Preferences>(() => defaults);

/** localStorage belongs to this browser/device, never the account. */
export function loadSingingAids(): void {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return;
    singingAidsStore.setState({
      countIn:
        'countIn' in raw && typeof raw.countIn === 'boolean'
          ? raw.countIn
          : true,
      guideMelody: 'guideMelody' in raw && raw.guideMelody === true,
      guideMelodyManual:
        'guideMelodyManual' in raw && typeof raw.guideMelodyManual === 'boolean'
          ? raw.guideMelodyManual
          : // Legacy v1 stored no manual mark: only an explicit opt-in
            // (true, away from the off default) proves a hand-picked choice.
            // An explicit-off is indistinguishable from never-touched, so it
            // keeps following the transposition instead of locking auto off.
            'guideMelody' in raw && raw.guideMelody === true,
      offset:
        // Old offsets included a different output compensation; keep the other aids.
        'calibrationVersion' in raw &&
        raw.calibrationVersion === CALIBRATION_VERSION &&
        'offset' in raw &&
        typeof raw.offset === 'number' &&
        Number.isFinite(raw.offset) &&
        Math.abs(raw.offset) <= 1
          ? raw.offset
          : 0,
    });
  } catch {
    /* Storage may be blocked; the controls still work for this visit. */
  }
}

export function saveSingingAids(value: Partial<Preferences>): void {
  singingAidsStore.setState(value);
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...singingAidsStore.getState(),
        calibrationVersion: CALIBRATION_VERSION,
      }),
    );
  } catch {
    /* Keep the in-memory preference when storage is unavailable. */
  }
}

/**
 * Follows a transposition the visitor did not pick by hand: on away from the
 * original key, off back on it. A hand-picked guide stays as the visitor
 * left it, on or off, so this never overrides a manual choice.
 */
export function autoGuideMelody(value: boolean): void {
  const state = singingAidsStore.getState();
  if (state.guideMelodyManual || state.guideMelody === value) return;
  saveSingingAids({ guideMelody: value });
}

export function useSingingAids<T>(selector: (state: Preferences) => T): T {
  return useStore(singingAidsStore, selector);
}
