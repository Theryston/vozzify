import { nearestKey, type TrackKey, type TrackNote } from '@vozzify/contracts';

// Key estimation as the legacy app does it (`estimateKey` in its
// `components/timeline/utils.ts`): the seconds each pitch class is sung form a
// normalized histogram, which is compared by cosine similarity with the
// Krumhansl-Schmuckler major and minor profiles rotated to each tonic. The
// first best score wins, major before minor for one tonic, and a note with no
// length counts as one second, as there.

const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
] as const;

const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
] as const;

const PROFILES = [
  { mode: 'MAJOR', profile: MAJOR_PROFILE },
  { mode: 'MINOR', profile: MINOR_PROFILE },
] as const;

const PITCH_CLASSES = 12;

/** The normalized seconds each pitch class is sung, from C (0) to B (11). */
function pitchClassHistogram(notes: readonly TrackNote[]): number[] {
  const histogram = Array.from({ length: PITCH_CLASSES }, () => 0);
  for (const note of notes) {
    const pitchClass =
      ((nearestKey(note.pitch) % PITCH_CLASSES) + PITCH_CLASSES) %
      PITCH_CLASSES;
    const seconds = Math.max(0, note.end - note.start) || 1;
    histogram[pitchClass] = (histogram[pitchClass] ?? 0) + seconds;
  }
  const sum = histogram.reduce((total, value) => total + value, 0) || 1;
  return histogram.map((value) => value / sum);
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  a.forEach((value, index) => {
    const other = b[index] ?? 0;
    dot += value * other;
    normA += value * value;
    normB += other * other;
  });
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/** The profile turned so that its first value falls on `tonic`. */
function rotated(profile: readonly number[], tonic: number): number[] {
  return Array.from(
    { length: PITCH_CLASSES },
    (_, index) => profile[(index - tonic + PITCH_CLASSES) % PITCH_CLASSES] ?? 0,
  );
}

/** The key a set of vocal notes is most likely in, or null without notes. */
export function estimateKey(notes: readonly TrackNote[]): TrackKey | null {
  if (notes.length === 0) {
    return null;
  }
  const histogram = pitchClassHistogram(notes);
  let best: { key: TrackKey; score: number } | null = null;
  for (let tonic = 0; tonic < PITCH_CLASSES; tonic += 1) {
    for (const { mode, profile } of PROFILES) {
      const score = cosineSimilarity(histogram, rotated(profile, tonic));
      if (best === null || score > best.score) {
        best = { key: { tonic, mode }, score };
      }
    }
  }
  return best?.key ?? null;
}
