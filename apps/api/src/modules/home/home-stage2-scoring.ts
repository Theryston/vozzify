export const HOME_STAGE2_PARAMETERS = {
  albumPopularityPrior: 25,
  albumConcentrationWeight: 0.3,
  albumVarietyMaximumBonus: 0.4,
  albumVarietyPrior: 3,
  personalMaximumLambda: 0.8,
  personalTrackPrior: 5,
  personalDayPrior: 5,
  voiceSamplePrior: 5,
  localeUserPrior: 20,
  localeDayPrior: 5,
  localeMinimumConfidence: 0.5,
  repeatWeight: 0.1,
  repeatCap: 3,
  socialSharedPrior: 3,
  socialCountWeight: 0.5,
  socialProportionWeight: 0.5,
  exposurePenalty: 0.25,
} as const;

/** Bounded quality of an Album's newly available Tracks. */
export const normalizedAlbumResidualScore = (
  popularity: readonly number[],
): number => {
  const total = popularity.reduce((sum, score) => sum + Math.max(0, score), 0);
  if (total <= 0) return 0;
  const topShare = Math.max(0, ...popularity) / total;
  const variety =
    1 +
    (HOME_STAGE2_PARAMETERS.albumVarietyMaximumBonus * popularity.length) /
      (popularity.length + HOME_STAGE2_PARAMETERS.albumVarietyPrior);
  return (
    ((total / (total + HOME_STAGE2_PARAMETERS.albumPopularityPrior)) *
      variety *
      (1 - HOME_STAGE2_PARAMETERS.albumConcentrationWeight * topShare)) /
    (1 + HOME_STAGE2_PARAMETERS.albumVarietyMaximumBonus)
  );
};

export const personalHistoryConfidence = (
  distinctTracks: number,
  activeDays: number,
): number => {
  if (distinctTracks <= 0 || activeDays <= 0) return 0;
  return Math.sqrt(
    (distinctTracks /
      (distinctTracks + HOME_STAGE2_PARAMETERS.personalTrackPrior)) *
      (activeDays / (activeDays + HOME_STAGE2_PARAMETERS.personalDayPrior)),
  );
};

export const personalConfidenceLambda = (
  distinctTracks: number,
  activeDays: number,
): number =>
  HOME_STAGE2_PARAMETERS.personalMaximumLambda *
  personalHistoryConfidence(distinctTracks, activeDays);

export const voiceEvidenceConfidence = (sampleCount: number): number =>
  sampleCount <= 0
    ? 0
    : sampleCount / (sampleCount + HOME_STAGE2_PARAMETERS.voiceSamplePrior);

export const personalScoreWithConfidenceAwareVoice = (
  tasteScore: number,
  voiceFit: number | null,
  confidence: number,
): number =>
  voiceFit === null || confidence <= 0
    ? tasteScore
    : (tasteScore + confidence * voiceFit) / (1 + confidence);

export const localeRankingConfidence = (
  distinctUsers: number,
  activeDays: number,
): number => {
  if (distinctUsers <= 0 || activeDays <= 0) return 0;
  return Math.sqrt(
    (distinctUsers / (distinctUsers + HOME_STAGE2_PARAMETERS.localeUserPrior)) *
      (activeDays / (activeDays + HOME_STAGE2_PARAMETERS.localeDayPrior)),
  );
};

export const hasSufficientLocaleEvidence = (
  distinctUsers: number,
  activeDays: number,
): boolean =>
  localeRankingConfidence(distinctUsers, activeDays) >=
  HOME_STAGE2_PARAMETERS.localeMinimumConfidence;

export const singerContribution = (validAttempts: number): number => {
  if (validAttempts <= 0) return 0;
  const repeats = Math.max(0, validAttempts - 1);
  return (
    1 +
    HOME_STAGE2_PARAMETERS.repeatWeight *
      Math.min(repeats, HOME_STAGE2_PARAMETERS.repeatCap)
  );
};

export const socialAffinityScore = (
  shared: number,
  ownVisibleTracks: number,
  otherVisibleTracks: number,
): number => {
  if (shared < 3 || ownVisibleTracks <= 0 || otherVisibleTracks <= 0) return 0;
  const { socialCountWeight, socialProportionWeight, socialSharedPrior } =
    HOME_STAGE2_PARAMETERS;
  return (
    socialCountWeight * (shared / (shared + socialSharedPrior)) +
    socialProportionWeight *
      (shared / Math.sqrt(ownVisibleTracks * otherVisibleTracks))
  );
};

export const communityCooccurrenceScore = (
  sharedUsers: number,
  sourceTrackUsers: number,
  candidateTrackUsers: number,
): number =>
  sourceTrackUsers <= 0 || candidateTrackUsers <= 0
    ? 0
    : sharedUsers / Math.sqrt(sourceTrackUsers * candidateTrackUsers);

export const progressiveExposureFactor = (priorExposures: number): number =>
  1 /
  (1 + HOME_STAGE2_PARAMETERS.exposurePenalty * Math.max(0, priorExposures));
