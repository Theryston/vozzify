import { estimateKey } from './track-key.js';

/** Notes of one second each, one after the other, for these MIDI pitches. */
const sung = (...pitches: number[]) =>
  pitches.map((pitch, index) => ({ pitch, start: index, end: index + 1 }));

/**
 * The legacy app's `estimateKey` (`components/timeline/utils.ts` of
 * theryston/notefinder), copied as it is except that it takes MIDI pitches
 * where it took a note name and an octave, and is typed for strict TypeScript. The tests compare the new function
 * with it, so the two cannot drift apart.
 */
function legacyEstimateKey(
  notes: { pitch: number; start?: number; end?: number }[],
): { tonic: number; mode: 'MAJOR' | 'MINOR' } | null {
  if (notes.length === 0) return null;
  const hist: number[] = new Array(12).fill(0);
  for (const n of notes) {
    const midi = Math.floor(n.pitch + 0.5);
    const pc = ((midi % 12) + 12) % 12;
    const dur = Math.max(0, (n.end ?? 0) - (n.start ?? 0)) || 1;
    hist[pc] = (hist[pc] ?? 0) + dur;
  }
  const sum = hist.reduce((a, b) => a + b, 0) || 1;
  const h = hist.map((x) => x / sum);
  const majorProfile = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
  ];
  const minorProfile = [
    6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
  ];
  const cosine = (a: number[], b: number[]) => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < 12; i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  };
  const rotated = (profile: number[], k: number) => {
    const out: number[] = new Array(12);
    for (let i = 0; i < 12; i++) out[i] = profile[(i - k + 12) % 12] ?? 0;
    return out;
  };
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestIndex = 0;
  let bestMode: 'MAJOR' | 'MINOR' = 'MAJOR';
  for (let k = 0; k < 12; k++) {
    const major = cosine(h, rotated(majorProfile, k));
    if (major > bestScore) {
      bestScore = major;
      bestIndex = k;
      bestMode = 'MAJOR';
    }
    const minor = cosine(h, rotated(minorProfile, k));
    if (minor > bestScore) {
      bestScore = minor;
      bestIndex = k;
      bestMode = 'MINOR';
    }
  }
  return { tonic: bestIndex, mode: bestMode };
}

/** Melodies of different shapes: scales, a lone note, flat and lopsided ones. */
const MELODIES: Record<
  string,
  { pitch: number; start: number; end: number }[]
> = {
  'G major scale': sung(67, 69, 71, 72, 74, 76, 78, 67, 67, 74),
  'A minor scale': sung(57, 59, 60, 62, 64, 65, 67, 57, 57, 64, 64, 57),
  'chromatic run': sung(60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71),
  'a single note': sung(66),
  'two notes a fifth apart': sung(60, 67),
  'high and low octaves': sung(36, 48, 60, 72, 84, 43, 55, 67, 79),
  'between two keys': sung(66.6, 66.6, 69, 71.4, 73),
  'zero-length notes only': [
    { pitch: 62, start: 3, end: 3 },
    { pitch: 66, start: 4, end: 4 },
    { pitch: 69, start: 5, end: 5 },
  ],
  'long and short notes': [
    { pitch: 61, start: 0, end: 0.05 },
    { pitch: 61, start: 1, end: 1.05 },
    { pitch: 62, start: 10, end: 20 },
    { pitch: 66, start: 20, end: 24 },
    { pitch: 69, start: 24, end: 29 },
  ],
};

describe('estimateKey', () => {
  it('finds a major key from its scale', () => {
    expect(estimateKey(MELODIES['G major scale'] ?? [])).toEqual({
      tonic: 7,
      mode: 'MAJOR',
    });
  });

  it('finds a minor key from its scale', () => {
    expect(estimateKey(MELODIES['A minor scale'] ?? [])).toEqual({
      tonic: 9,
      mode: 'MINOR',
    });
  });

  it.each(Object.entries(MELODIES))(
    'answers what the legacy function answers for %s',
    (_name, notes) => {
      expect(estimateKey(notes)).toEqual(legacyEstimateKey(notes));
    },
  );

  it('counts a note with no length as one second, as the legacy app does', () => {
    // Only zero-length notes: each is one second, so the key is still found.
    expect(estimateKey(MELODIES['zero-length notes only'] ?? [])).toEqual({
      tonic: 2,
      mode: 'MAJOR',
    });
  });

  it('weighs a pitch class by how long it is held, not by how many notes', () => {
    expect(estimateKey(MELODIES['long and short notes'] ?? [])).toEqual({
      tonic: 2,
      mode: 'MAJOR',
    });
  });

  it('puts the same notes in another octave in the same key', () => {
    const notes = MELODIES['G major scale'] ?? [];

    expect(
      estimateKey(notes.map((note) => ({ ...note, pitch: note.pitch - 24 }))),
    ).toEqual(estimateKey(notes));
  });

  it('has no key without notes', () => {
    expect(estimateKey([])).toBeNull();
  });
});
