/**
 * Offline-only numerical candidates for #485. Feed code must not import this
 * file until a maintainer validates a parameter set and algorithm version.
 */
export const HOME_RANKING_CALIBRATION_PROPOSAL = {
  albumVarietyWeight: 0.2,
  albumConcentrationWeight: 0.3,
  albumOverlapWeight: 0.25,
  albumPopularityPrior: 25,
  albumVarietyUnitsCap: 2,
  distinctSingerRepeatPenalty: 0.1,
  localeSamplePrior: 20,
  personalHistoryAttemptPrior: 5,
  voiceEvidenceSamplePrior: 5,
  explorationShare: 0.2,
  progressiveArtistExposurePenalty: 0.25,
  socialAffinityWeight: 0.1,
  minimumSharedSocialTracks: 3,
  temporaryExposureInitialPenalty: 0.1,
  temporaryExposureHalfLifeHours: 24,
  weakIgnoredImpressionPenalty: 0.02,
  weakIgnoredImpressionPenaltyCap: 0.1,
} as const;

/** A bounded Album comparison score; this proposal is not used in feeds. */
export const saturatingAlbumScore = (
  trackPopularity: number[],
  overlapShare = 0,
): number => {
  const total = trackPopularity.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  const distinctCount = trackPopularity.length;
  const topTrackPopularity = trackPopularity.reduce(
    (top, value) => Math.max(top, value),
    0,
  );
  const topTrackShare = topTrackPopularity / total;
  const varietyUnits = Math.min(
    Math.log2(1 + distinctCount),
    HOME_RANKING_CALIBRATION_PROPOSAL.albumVarietyUnitsCap,
  );
  const boundedPopularity =
    total / (total + HOME_RANKING_CALIBRATION_PROPOSAL.albumPopularityPrior);
  const varietyFactor =
    1 + HOME_RANKING_CALIBRATION_PROPOSAL.albumVarietyWeight * varietyUnits;
  const concentrationFactor =
    1 -
    HOME_RANKING_CALIBRATION_PROPOSAL.albumConcentrationWeight * topTrackShare;
  const overlapFactor =
    1 - HOME_RANKING_CALIBRATION_PROPOSAL.albumOverlapWeight * overlapShare;
  return (
    boundedPopularity * varietyFactor * concentrationFactor * overlapFactor
  );
};

/** Confidence given to observed signals against a fixed prior sample size. */
export const calibrationConfidence = (
  observations: number,
  prior: number,
): number => observations / (observations + prior);

/** Repetition factor after the first distinct singer exposure. */
export const distinctSingerRepeatFactor = (repeatedExposures: number): number =>
  Math.max(
    0,
    1 -
      HOME_RANKING_CALIBRATION_PROPOSAL.distinctSingerRepeatPenalty *
        repeatedExposures,
  );

/** Progressive exposure factor after earlier Artist exposure. */
export const progressiveArtistExposureFactor = (
  priorExposures: number,
): number =>
  1 /
  (1 +
    HOME_RANKING_CALIBRATION_PROPOSAL.progressiveArtistExposurePenalty *
      priorExposures);

/** Social affinity is unavailable below the fixed shared-Track minimum. */
export const socialAffinityContribution = (sharedTracks: number): number =>
  sharedTracks < HOME_RANKING_CALIBRATION_PROPOSAL.minimumSharedSocialTracks
    ? 0
    : HOME_RANKING_CALIBRATION_PROPOSAL.socialAffinityWeight;

/** Temporary exposure penalty after exponential decay by its half-life. */
export const temporaryExposurePenalty = (ageHours: number): number =>
  HOME_RANKING_CALIBRATION_PROPOSAL.temporaryExposureInitialPenalty *
  2 **
    (-ageHours /
      HOME_RANKING_CALIBRATION_PROPOSAL.temporaryExposureHalfLifeHours);

/** Weak ignored impressions reduce relevance with a fixed maximum effect. */
export const weakIgnoredImpressionPenalty = (count: number): number =>
  Math.min(
    HOME_RANKING_CALIBRATION_PROPOSAL.weakIgnoredImpressionPenaltyCap,
    count * HOME_RANKING_CALIBRATION_PROPOSAL.weakIgnoredImpressionPenalty,
  );
