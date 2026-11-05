import type { HomeRow, HomeTrack } from '@vozzify/contracts';
import { composePersonalHomeRows } from './home-personal-composition.js';

const track = (id: string): HomeTrack => ({
  id,
  title: id,
  coverUrl: null,
  artistCredit: [{ name: id, joinPhrase: '' }],
  durationMs: null,
  vocalRange: null,
});

const person = (id: string) => ({
  id,
  username: id,
  name: id,
  image: null,
  commonTracks: 3,
});

const dailyTarget: HomeRow = {
  id: 'daily-target',
  layout: 'daily-target',
  title: { key: 'home.rows.dailyTarget', params: {} },
  secondsLeft: 60,
  targetSeconds: 300,
  streakDays: 1,
  completedToday: false,
};

describe('composePersonalHomeRows', () => {
  it('keeps Daily target after the hero and restores categories early', () => {
    const hero: HomeRow = { id: 'hero', layout: 'hero', track: track('hero') };
    const resumes: HomeRow[] = [
      {
        id: 'continue-singing',
        layout: 'standard',
        title: { key: 'home.rows.continueSinging', params: {} },
        items: [track('resume')],
      },
    ];
    const people: HomeRow = {
      id: 'people-who-sing-what-you-sing',
      layout: 'people',
      title: { key: 'home.rows.peopleWhoSingWhatYouSing', params: {} },
      items: [person('one'), person('two'), person('three')],
    };
    const albums: HomeRow = {
      id: 'featured-albums',
      layout: 'albums',
      title: { key: 'home.rows.featuredAlbums', params: {} },
      items: Array.from({ length: 3 }, (_, index) => ({
        id: `album-${index}`,
        title: `Album ${index}`,
        coverArtUrl: null,
        year: null,
      })),
    };
    const artist: HomeRow = {
      id: 'featured-artists',
      layout: 'artists',
      title: { key: 'home.rows.featuredArtists', params: {} },
      items: Array.from({ length: 3 }, (_, index) => ({
        id: `artist-${index}`,
        name: `Artist ${index}`,
      })),
    };
    const genre: HomeRow = {
      id: 'genres',
      layout: 'genres',
      title: { key: 'home.rows.genres', params: {} },
      items: [],
    };
    const ranked: HomeRow = {
      id: 'top-10-week',
      layout: 'ranked',
      title: { key: 'home.rows.top10Week', params: {} },
      items: [track('chart')],
    };

    const rows = composePersonalHomeRows({
      hero,
      dailyTarget,
      resumes,
      socialRows: [people],
      publicRows: [genre, artist, albums, ranked],
      recommendations: [hero],
    });

    expect(rows[0]).toBe(hero);
    expect(rows[1]).toBe(dailyTarget);
    expect(rows.slice(0, 6).some((row) => row.layout === 'people')).toBe(true);
    expect(rows).toEqual(
      expect.arrayContaining([people, genre, artist, albums, ranked]),
    );
  });

  it('puts Daily target first when no hero is available', () => {
    const rows = composePersonalHomeRows({
      hero: undefined,
      dailyTarget,
      resumes: [],
      socialRows: [],
      publicRows: [],
      recommendations: [],
    });

    expect(rows[0]).toBe(dailyTarget);
  });
});
