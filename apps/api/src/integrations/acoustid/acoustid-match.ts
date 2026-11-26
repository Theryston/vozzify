import type { Mbid } from '@vozzify/contracts';

// Require a near-identical fingerprint and distance from competing clusters.
// Shared song metadata or an unknown label is never positive evidence.
const MIN_SCORE = 0.95;
const MIN_LEAD = 0.05;

type Hit = { score: number; recordings?: readonly { id: Mbid }[] };

function onlyMbid(hit: Hit): Mbid | undefined {
  const ids = new Set(hit.recordings?.map(({ id }) => id));
  return ids.size === 1 ? ids.values().next().value : undefined;
}

export function confidentRecordingMbid(hits: readonly Hit[]): Mbid | null {
  const [first, ...alternatives] = hits.toSorted((a, b) => b.score - a.score);
  if (!first || first.score < MIN_SCORE) return null;
  const mbid = onlyMbid(first);
  if (!mbid) return null;
  const ambiguous = alternatives.some(
    (hit) => hit.score > first.score - MIN_LEAD && onlyMbid(hit) !== mbid,
  );
  return ambiguous ? null : mbid;
}
