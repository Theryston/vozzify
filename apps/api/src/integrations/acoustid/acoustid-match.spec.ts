import { confidentRecordingMbid } from './acoustid-match.js';

const STUDIO = 'c2139b0f-f6f8-4494-8a24-8aebb99a940d';
const LIVE = 'bfc974fd-e021-47aa-8e54-01b9d136bbcf';

const hit = (score: number, ...ids: string[]) => ({
  score,
  recordings: ids.map((id) => ({ id })),
});

describe('AcoustID exact Recording evidence', () => {
  it('links a strong studio fingerprint over a distant live take', () => {
    expect(confidentRecordingMbid([hit(0.89, LIVE), hit(0.98, STUDIO)])).toBe(
      STUDIO,
    );
  });

  it('links a YouTube transcode when several clusters refer to its same Recording', () => {
    expect(
      confidentRecordingMbid([
        hit(0.97, LIVE),
        hit(0.96, LIVE),
        hit(0.83, STUDIO),
      ]),
    ).toBe(LIVE);
  });

  it.each([
    ['cover with a weak hit', [hit(0.84, STUDIO)]],
    [
      'equally plausible studio and live takes',
      [hit(1, STUDIO), hit(0.98, LIVE)],
    ],
    ['cluster attributed to multiple Recordings', [hit(1, STUDIO, LIVE)]],
    ['strong cluster with no Recording ID', [hit(1), hit(0.95, STUDIO)]],
    ['strong unlabelled alternative', [hit(1, STUDIO), hit(0.98)]],
    ['no lookup hits', []],
  ])('leaves %s unlinked', (_name, results) => {
    expect(confidentRecordingMbid(results)).toBeNull();
  });
});
