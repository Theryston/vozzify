import { describe, expect, it, vi } from 'vitest';
import { LegacyCatalogMapIdentityService } from './legacy-catalog-map-identity.service.js';
import type { LegacyCatalogMapInputs } from './legacy-catalog-map-input.service.js';
import { LegacyCatalogMapReconciler } from './legacy-catalog-map-reconciler.js';

const sourceTrack = (
  id: string,
  artistId = 'legacy-artist',
  albumId = 'legacy-album',
) => ({
  id,
  ytId: `video-${id}`,
  title: `Song ${id}`,
  durationSeconds: 180,
  duration: '3:00',
  albumId,
  albumName: 'Album',
  albumYtId: 'album-video',
  creatorId: 'legacy-user',
  createdAt: new Date('2020-01-01T00:00:00Z'),
  dependentFavorites: 0,
  dependentViews: 0,
  artists: [{ id: artistId, name: 'Artist', ytId: 'artist-channel' }],
});

const plan = (id: string) => ({
  status: 'planned',
  recordingMbid: `recording-${id}`,
  trackId: `new-${id}`,
  processingId: `processing-${id}`,
  metadataStatus: 'completed',
  source: sourceTrack(id),
});

const makeReconciler = () => {
  const identities = {
    findArtistEvidence: vi
      .fn()
      .mockResolvedValue([
        { trackId: 'new-one', mbid: 'artist-mbid', creditedName: 'Artist' },
      ]),
    findAlbumEvidence: vi.fn().mockResolvedValue([
      {
        trackId: 'new-one',
        mbid: 'album-mbid',
        title: 'Album',
        artistMbids: ['artist-mbid'],
      },
    ]),
    findArtistId: vi.fn().mockResolvedValue('artist-id'),
    mapArtist: vi.fn().mockResolvedValue(undefined),
    findAlbumId: vi.fn().mockResolvedValue('album-id'),
    mapAlbum: vi.fn().mockResolvedValue(undefined),
  };
  return {
    reconciler: new LegacyCatalogMapReconciler(
      identities as unknown as LegacyCatalogMapIdentityService,
    ),
    identities,
  };
};

const inputs = (
  plans: LegacyCatalogMapInputs['plans'],
  artists: LegacyCatalogMapInputs['artists'] = [],
  albums: LegacyCatalogMapInputs['albums'] = [],
): LegacyCatalogMapInputs => ({ plans, artists, albums });

describe('LegacyCatalogMapReconciler', () => {
  it('maps multiple legacy IDs to one shared metadata identity', async () => {
    const { reconciler, identities } = makeReconciler();
    const result = await reconciler.reconcile(
      inputs([
        {
          ...plan('one'),
          source: sourceTrack('one', 'legacy-artist-one', 'legacy-album-one'),
        },
        {
          ...plan('one'),
          source: sourceTrack('two', 'legacy-artist-two', 'legacy-album-two'),
        },
      ]),
    );

    expect(result.artists.mapped).toBe(2);
    expect(result.albums.mapped).toBe(2);
    expect(identities.mapArtist).toHaveBeenCalledWith(
      'legacy-artist-one',
      'artist-id',
    );
    expect(identities.mapAlbum).toHaveBeenCalledWith(
      'legacy-album-two',
      'album-id',
    );
  });

  it('reports source Artist and Album rows with no planned Track independently', async () => {
    const { reconciler } = makeReconciler();
    const result = await reconciler.reconcile(
      inputs(
        [],
        [{ id: 'orphan-artist', name: 'Orphan', ytId: 'channel' }],
        [{ id: 'orphan-album', name: 'Orphan record', ytId: 'video' }],
      ),
    );

    expect(result.artists.unresolvedItems).toEqual([
      { legacyId: 'orphan-artist', reason: 'no-planned-track' },
    ]);
    expect(result.albums.unresolvedItems).toEqual([
      { legacyId: 'orphan-album', reason: 'no-planned-track' },
    ]);
  });

  it('keeps failed metadata pending and does not classify it as missing', async () => {
    const { reconciler, identities } = makeReconciler();
    const result = await reconciler.reconcile(
      inputs([{ ...plan('one'), metadataStatus: 'failed' }]),
    );

    expect(result.artists.pendingItems).toEqual([
      { legacyId: 'legacy-artist', reason: 'metadata-import-failed' },
    ]);
    expect(result.albums.pendingItems).toEqual([
      { legacyId: 'legacy-album', reason: 'metadata-import-failed' },
    ]);
    expect(identities.mapArtist).not.toHaveBeenCalled();
  });

  it('does not map ambiguous Artists or release groups sharing the same title', async () => {
    const { reconciler, identities } = makeReconciler();
    identities.findArtistEvidence.mockResolvedValue([
      { trackId: 'new-one', mbid: 'artist-a', creditedName: 'Artist' },
      { trackId: 'new-one', mbid: 'artist-b', creditedName: 'Artist' },
    ]);
    identities.findAlbumEvidence.mockResolvedValue([
      {
        trackId: 'new-one',
        mbid: 'album-a',
        title: 'Album',
        artistMbids: ['artist-a'],
      },
      {
        trackId: 'new-one',
        mbid: 'album-b',
        title: 'Album',
        artistMbids: ['artist-a'],
      },
    ]);

    const result = await reconciler.reconcile(inputs([plan('one')]));

    expect(result.artists.unresolvedItems).toEqual([
      { legacyId: 'legacy-artist', reason: 'ambiguous' },
    ]);
    expect(result.albums.unresolvedItems).toEqual([
      { legacyId: 'legacy-album', reason: 'ambiguous' },
    ]);
    expect(identities.mapArtist).not.toHaveBeenCalled();
    expect(identities.mapAlbum).not.toHaveBeenCalled();
  });
});
