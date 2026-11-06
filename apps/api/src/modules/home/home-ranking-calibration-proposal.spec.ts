import { describe, expect, it } from 'vitest';
import {
  calibrationConfidence,
  distinctSingerRepeatFactor,
  HOME_RANKING_CALIBRATION_PROPOSAL,
  personalHistoryConfidence,
  progressiveArtistExposureFactor,
  saturatingAlbumScore,
  socialAffinityContribution,
  temporaryExposurePenalty,
  weakIgnoredImpressionPenalty,
} from './home-ranking-calibration-proposal.js';

describe('offline Home ranking calibration proposal', () => {
  it('saturates popularity and variety for bounded Album comparisons', () => {
    expect(saturatingAlbumScore([100, 0, 0])).toBeCloseTo(0.784, 3);
    expect(saturatingAlbumScore([40, 35, 25])).toBeCloseTo(0.986, 3);
    expect(saturatingAlbumScore([15, 12, 10, 8, 5])).toBeCloseTo(0.849, 3);
    expect(
      saturatingAlbumScore(Array.from({ length: 20 }, () => 1)),
    ).toBeCloseTo(0.613, 3);
    expect(saturatingAlbumScore([100, 60, 40], 2 / 3)).toBeCloseTo(0.8815, 3);
    expect(saturatingAlbumScore([70, 60, 50])).toBeCloseTo(1.086, 3);
    expect(saturatingAlbumScore([10, 10])).toBeCloseTo(0.498, 3);
  });

  it('keeps fixed policy values and album candidates named', () => {
    expect(HOME_RANKING_CALIBRATION_PROPOSAL).toMatchObject({
      albumVarietyWeight: 0.2,
      albumConcentrationWeight: 0.3,
      albumOverlapWeight: 0.25,
      explorationShare: 0.2,
      minimumSharedSocialTracks: 3,
    });
  });

  it('shrinks sparse locale, personal and voice samples deterministically', () => {
    expect(calibrationConfidence(4, 20)).toBeCloseTo(0.167, 3);
    expect(calibrationConfidence(3, 5)).toBeCloseTo(0.375, 3);
    expect(calibrationConfidence(1, 5)).toBeCloseTo(0.167, 3);
  });

  it('discounts repeated one-Track days against varied personal practice', () => {
    const repeated = Array.from({ length: 100 }, () => ({
      trackId: 'same-track',
      practiceDay: '2026-11-01',
    }));
    const varied = Array.from({ length: 100 }, (_, index) => ({
      trackId: `track-${index}`,
      practiceDay: new Date(Date.UTC(2026, 0, index + 1))
        .toISOString()
        .slice(0, 10),
    }));

    expect(calibrationConfidence(100, 5)).toBeCloseTo(0.952, 3);
    expect(personalHistoryConfidence(repeated)).toBeCloseTo(0.167, 3);
    expect(personalHistoryConfidence(varied)).toBeCloseTo(0.952, 3);
  });

  it('penalizes repeated singer and progressive Artist exposure', () => {
    expect(distinctSingerRepeatFactor(3)).toBeCloseTo(0.7);
    expect(progressiveArtistExposureFactor(3)).toBeCloseTo(0.571, 3);
  });

  it('holds the social minimum and decays temporary exposure by half-life', () => {
    expect(socialAffinityContribution(2)).toBe(0);
    expect(socialAffinityContribution(3)).toBe(0.1);
    expect(temporaryExposurePenalty(0)).toBeCloseTo(0.1);
    expect(temporaryExposurePenalty(24)).toBeCloseTo(0.05);
    expect(temporaryExposurePenalty(48)).toBeCloseTo(0.025);
  });

  it('caps weak ignored-impression effects', () => {
    expect(weakIgnoredImpressionPenalty(2)).toBeCloseTo(0.04);
    expect(weakIgnoredImpressionPenalty(5)).toBeCloseTo(0.1);
  });
});
