import { describe, expect, it } from 'vitest';
import {
  buildSocialRows,
  type SocialCandidate,
} from './home-social-similarity.js';

const candidate = (
  id: string,
  commonTracks: number,
  vocalDistance: SocialCandidate['vocalDistance'] = null,
): SocialCandidate => ({
  id,
  username: id,
  name: id,
  image: null,
  commonTracks,
  vocalDistance,
});

describe('buildSocialRows', () => {
  it('requires at least three people with three common tracks each', () => {
    expect(
      buildSocialRows(
        Array.from({ length: 2 }, (_, i) => candidate(`${i}`, 4)),
      ),
    ).toEqual([]);
    expect(
      buildSocialRows(
        Array.from({ length: 6 }, (_, i) => candidate(`${i}`, 2)),
      ),
    ).toEqual([]);
    expect(
      buildSocialRows(
        Array.from({ length: 3 }, (_, i) => candidate(`${i}`, 4)),
      )[0]?.items,
    ).toHaveLength(3);
  });

  it('orders similar voices by stored range closeness and shows the overlap', () => {
    const candidates = [
      candidate('farther', 8, 30),
      candidate('closest', 3, 2),
      ...Array.from({ length: 4 }, (_, i) =>
        candidate(`other-${i}`, 5, 10 + i),
      ),
    ];
    const [common, similar] = buildSocialRows(candidates);

    expect(common?.items[0]).toMatchObject({ id: 'farther', commonTracks: 8 });
    expect(similar?.items[0]).toMatchObject({ id: 'closest', commonTracks: 3 });
  });

  it('omits similar voices unless six candidates have derived ranges', () => {
    const candidates = Array.from({ length: 6 }, (_, index) =>
      candidate(`person-${index}`, 3),
    );

    expect(buildSocialRows(candidates).map((row) => row.id)).toEqual([
      'people-who-sing-what-you-sing',
    ]);
  });
});
