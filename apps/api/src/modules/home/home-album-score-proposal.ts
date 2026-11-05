/** Candidate weights for comparison only; production selection does not call this. */
const HOME_ALBUM_SCORE_PROPOSAL = {
  varietyWeight: 0.2,
  concentrationWeight: 0.3,
  overlapWeight: 0.25,
} as const;

/**
 * An offline candidate score for bounded calibration fixtures. Keep the
 * production baseline at raw Track popularity until maintainers validate it.
 */
export const proposedAlbumScore = (
  trackPopularities: readonly number[],
  sharedTrackCount = 0,
): number => {
  if (trackPopularities.length === 0) return 0;
  const popularity = trackPopularities.reduce(
    (total, score) => total + Math.max(0, score),
    0,
  );
  if (popularity === 0) return 0;
  const topTrackPopularity = Math.max(...trackPopularities, 0);
  const concentration = topTrackPopularity / popularity;
  const overlap = Math.min(
    1,
    Math.max(0, sharedTrackCount) / trackPopularities.length,
  );
  const varietyMultiplier =
    1 +
    HOME_ALBUM_SCORE_PROPOSAL.varietyWeight *
      Math.log2(1 + trackPopularities.length);
  const concentrationMultiplier =
    1 - HOME_ALBUM_SCORE_PROPOSAL.concentrationWeight * concentration;
  const overlapMultiplier =
    1 - HOME_ALBUM_SCORE_PROPOSAL.overlapWeight * overlap;
  return (
    popularity * varietyMultiplier * concentrationMultiplier * overlapMultiplier
  );
};
