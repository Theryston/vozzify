import {
  communityCooccurrenceScore,
  hasSufficientLocaleEvidence,
  localeRankingConfidence,
  normalizedAlbumResidualScore,
  personalConfidenceLambda,
  personalHistoryConfidence,
  personalScoreWithConfidenceAwareVoice,
  progressiveExposureFactor,
  singerContribution,
  socialAffinityScore,
  voiceEvidenceConfidence,
} from './home-stage2-scoring.js';

describe('Stage 2 scoring candidate', () => {
  it('normalizes incremental Album quality and handles no positive residual', () => {
    expect(normalizedAlbumResidualScore([100, 0, 0])).toBeCloseTo(0.48, 5);
    expect(normalizedAlbumResidualScore([40, 35, 25])).toBeCloseTo(0.603429, 5);
    expect(normalizedAlbumResidualScore([0, 0])).toBe(0);
  });

  it('keeps a global popularity floor and requires both evidence axes', () => {
    expect(personalHistoryConfidence(0, 50)).toBe(0);
    expect(personalConfidenceLambda(1, 1)).toBeCloseTo(0.133333, 5);
    expect(personalConfidenceLambda(100, 100)).toBeCloseTo(0.761905, 5);
    expect(personalConfidenceLambda(100_000, 100_000)).toBeLessThanOrEqual(0.8);
  });

  it('weights voice by distinct qualifying evidence and falls back to taste', () => {
    expect(voiceEvidenceConfidence(1)).toBeCloseTo(1 / 6, 5);
    expect(voiceEvidenceConfidence(20)).toBeCloseTo(0.8, 5);
    expect(personalScoreWithConfidenceAwareVoice(0.4, null, 0.8)).toBe(0.4);
    expect(personalScoreWithConfidenceAwareVoice(0.4, 1, 0.8)).toBeCloseTo(
      2 / 3,
      5,
    );
  });

  it('requires locale breadth and activity before switching from global', () => {
    expect(localeRankingConfidence(5, 5)).toBeCloseTo(0.316228, 5);
    expect(hasSufficientLocaleEvidence(5, 5)).toBe(false);
    expect(hasSufficientLocaleEvidence(20, 5)).toBe(true);
  });

  it('caps repeat contribution, balances social sets, and decays exposure', () => {
    expect(singerContribution(100)).toBe(1.3);
    expect(socialAffinityScore(3, 5, 5)).toBeCloseTo(0.55, 5);
    expect(socialAffinityScore(3, 5, 500)).toBeCloseTo(0.28, 5);
    expect(socialAffinityScore(2, 5, 5)).toBe(0);
    expect(communityCooccurrenceScore(3, 0, 4)).toBe(0);
    expect(progressiveExposureFactor(3)).toBeCloseTo(0.571429, 5);
  });

  it('ranks singer breadth above one prolific singer', () => {
    const prolificSinger = singerContribution(100);
    const broadSingers = Array.from({ length: 10 }, () =>
      singerContribution(1),
    ).reduce((sum, contribution) => sum + contribution, 0);

    expect(prolificSinger).toBe(1.3);
    expect(broadSingers).toBe(10);
  });
});
