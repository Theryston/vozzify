import { describe, expect, it } from 'vitest';
import {
  matchLegacyAlbum,
  matchLegacyArtist,
} from './legacy-catalog-map-matching.js';

describe('matchLegacyArtist', () => {
  it('maps one exact credited identity shared by every occurrence', () => {
    expect(
      matchLegacyArtist('Queen', [
        [{ mbid: 'artist-1', creditedNames: ['Queen'] }],
        [{ mbid: 'artist-1', creditedNames: ['Queen'] }],
      ]),
    ).toEqual({ status: 'mapped', mbid: 'artist-1' });
  });

  it('does not use a similar name or choose between same-name identities', () => {
    expect(
      matchLegacyArtist('Queen', [
        [{ mbid: 'artist-1', creditedNames: ['Queen II'] }],
      ]),
    ).toEqual({ status: 'unresolved', reason: 'no-match' });
    expect(
      matchLegacyArtist('Queen', [
        [
          { mbid: 'artist-1', creditedNames: ['Queen'] },
          { mbid: 'artist-2', creditedNames: ['Queen'] },
        ],
      ]),
    ).toEqual({ status: 'unresolved', reason: 'ambiguous' });
  });

  it('leaves conflicting occurrences unresolved', () => {
    expect(
      matchLegacyArtist('Queen', [
        [{ mbid: 'artist-1', creditedNames: ['Queen'] }],
        [{ mbid: 'artist-2', creditedNames: ['Queen'] }],
      ]),
    ).toEqual({ status: 'unresolved', reason: 'conflict' });
  });
});

describe('matchLegacyAlbum', () => {
  it('maps only one exact release-group identity shared by every occurrence', () => {
    expect(
      matchLegacyAlbum('A Night at the Opera', [
        {
          albums: [
            {
              mbid: 'release-group-1',
              title: 'A Night at the Opera',
              artistMbids: ['artist-1'],
            },
          ],
          recordingArtistMbids: ['artist-1'],
        },
        {
          albums: [
            {
              mbid: 'release-group-1',
              title: 'A Night at the Opera',
              artistMbids: ['artist-1'],
            },
          ],
          recordingArtistMbids: ['artist-1'],
        },
      ]),
    ).toEqual({ status: 'mapped', mbid: 'release-group-1' });
  });

  it('does not choose between different release groups on the same Recording', () => {
    expect(
      matchLegacyAlbum('Greatest Hits', [
        {
          albums: [
            {
              mbid: 'album-1',
              title: 'Greatest Hits',
              artistMbids: ['artist-1'],
            },
            {
              mbid: 'album-2',
              title: 'Greatest Hits',
              artistMbids: ['artist-1'],
            },
          ],
          recordingArtistMbids: ['artist-1'],
        },
      ]),
    ).toEqual({ status: 'unresolved', reason: 'ambiguous' });
  });

  it('leaves conflicting occurrences unresolved', () => {
    expect(
      matchLegacyAlbum('Album', [
        {
          albums: [
            { mbid: 'album-1', title: 'Album', artistMbids: ['artist-1'] },
          ],
          recordingArtistMbids: ['artist-1'],
        },
        {
          albums: [
            { mbid: 'album-2', title: 'Album', artistMbids: ['artist-1'] },
          ],
          recordingArtistMbids: ['artist-1'],
        },
      ]),
    ).toEqual({ status: 'unresolved', reason: 'conflict' });
  });

  it('rejects a sole same-title release group with incompatible artists', () => {
    expect(
      matchLegacyAlbum('Greatest Hits', [
        {
          albums: [
            {
              mbid: 'unrelated-compilation',
              title: 'Greatest Hits',
              artistMbids: ['unrelated-artist'],
            },
          ],
          recordingArtistMbids: ['legacy-artist-canonical'],
        },
      ]),
    ).toEqual({ status: 'unresolved', reason: 'no-match' });
  });
});
