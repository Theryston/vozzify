import { reconcileCutover } from './legacy-cutover-report.js';

describe('staged cutover report', () => {
  const inventory = () => ({
    users: 1,
    accounts: 1,
    practiceDays: 1,
    favorites: 3,
    views: 2,
    tracks: ['old-a', 'old-b', 'unmatched'],
    artists: ['artist'],
    albums: ['album'],
    errors: [],
  });
  const destination = () => ({
    users: { status: 'complete', importedUsers: 1, importedAccounts: 1 },
    personal: { status: 'complete', importedPracticeDays: 1 },
    planComplete: true,
    relationships: {
      status: 'complete',
      acceptedFavorites: 2,
      importedFavorites: 1,
      deduplicatedFavorites: 1,
      importedViews: 1,
      skippedFavorites: 1,
      skippedViews: 1,
    },
    tracks: [
      {
        legacyId: 'old-a',
        recordingMbid: 'recording',
        trackId: 'new',
        mappedTrackId: 'new',
        processingId: 'attempt',
        status: 'planned',
        processingStatus: 'QUEUED',
        metadataStatus: 'pending',
        reason: null,
      },
      {
        legacyId: 'old-b',
        recordingMbid: 'recording',
        trackId: 'new',
        mappedTrackId: 'new',
        processingId: 'attempt',
        status: 'planned',
        processingStatus: 'QUEUED',
        metadataStatus: 'pending',
        reason: null,
      },
      {
        legacyId: 'unmatched',
        recordingMbid: null,
        trackId: null,
        mappedTrackId: null,
        processingId: null,
        status: 'skipped',
        processingStatus: null,
        metadataStatus: null,
        reason: 'NO_ACCEPTABLE_RECORDING',
      },
    ],
    artistMaps: [],
    albumMaps: [],
  });

  it('is ready with queued work and explicit skips but is not finished', () => {
    expect(reconcileCutover(inventory(), destination())).toMatchObject({
      ready: true,
      finished: false,
      recordings: { imported: 1, duplicateTracks: 1, skipped: 1, pending: 0 },
      processing: { pending: 1, completed: 0, failed: 0 },
      favorites: {
        source: 3,
        retained: 1,
        deduplicated: 1,
        skipped: 1,
        pending: 0,
      },
    });
  });

  it('retains failed Processings and explicit auxiliary skips as final outcomes', () => {
    const saved = destination();
    for (const row of saved.tracks.filter(
      (track) => track.status === 'planned',
    )) {
      row.processingStatus = 'FAILED';
      row.metadataStatus = 'completed';
    }
    expect(
      reconcileCutover(inventory(), saved, {
        artists: {
          mapped: 0,
          unresolved: 1,
          pending: 0,
          unresolvedItems: [{ legacyId: 'artist', reason: 'no-planned-track' }],
          pendingItems: [],
        },
        albums: {
          mapped: 0,
          unresolved: 1,
          pending: 0,
          unresolvedItems: [{ legacyId: 'album', reason: 'no-planned-track' }],
          pendingItems: [],
        },
      }),
    ).toMatchObject({
      ready: true,
      finished: true,
      processing: { pending: 0, completed: 0, failed: 1 },
      recordings: { imported: 1, skipped: 1 },
      auxiliaryMaps: { artists: { skipped: 1 }, albums: { skipped: 1 } },
    });
  });

  it.each(['users', 'personal', 'relationships'] as const)(
    'blocks readiness while %s is incomplete',
    (stage) => {
      const saved = destination();
      saved[stage].status = 'incomplete';
      expect(reconcileCutover(inventory(), saved).ready).toBe(false);
    },
  );

  it('does not hide unplanned source IDs or accept a skip without a reason', () => {
    const saved = destination();
    saved.tracks = saved.tracks.filter((row) => row.legacyId !== 'old-b');
    const report = reconcileCutover(inventory(), saved);
    expect(report).toMatchObject({
      ready: false,
      recordings: { pending: 1 },
      tracks: expect.arrayContaining([
        expect.objectContaining({
          legacyId: 'old-b',
          status: 'pending',
          reason: 'recording-not-planned',
        }),
      ]),
    });
    const invalidSkip = destination();
    const skipped = invalidSkip.tracks.find((row) => row.status === 'skipped');
    if (!skipped) throw new Error('Missing skip fixture');
    skipped.reason = null;
    expect(reconcileCutover(inventory(), invalidSkip).ready).toBe(false);
  });

  it('blocks readiness on missing maps, changed source, and inconsistent relationship counts', () => {
    const missingMap = destination();
    const track = missingMap.tracks[0];
    if (!track) throw new Error('Missing Track fixture');
    track.mappedTrackId = null;
    expect(reconcileCutover(inventory(), missingMap).ready).toBe(false);
    expect(
      reconcileCutover(
        { ...inventory(), errors: ['SOURCE_CHANGED'] },
        destination(),
      ).ready,
    ).toBe(false);
    const counts = destination();
    counts.relationships.deduplicatedFavorites = 0;
    expect(reconcileCutover(inventory(), counts).ready).toBe(false);
  });

  it('lists each excluded favorite and view with its source Track and reason', () => {
    expect(
      reconcileCutover(
        {
          ...inventory(),
          favoriteRows: [{ id: 'excluded-favorite', trackId: 'unmatched' }],
          viewRows: [{ id: 'excluded-view', trackId: 'unmatched' }],
        },
        destination(),
      ),
    ).toMatchObject({
      relationshipExclusions: {
        favorites: [
          {
            legacyId: 'excluded-favorite',
            legacyTrackId: 'unmatched',
            destinationTrackId: null,
            status: 'skipped',
            reason: 'NO_ACCEPTABLE_RECORDING',
          },
        ],
        views: [
          {
            legacyId: 'excluded-view',
            legacyTrackId: 'unmatched',
            destinationTrackId: null,
            status: 'skipped',
            reason: 'NO_ACCEPTABLE_RECORDING',
          },
        ],
      },
    });
  });

  it('reports all source work as pending before the first checkpoint', () => {
    expect(
      reconcileCutover(inventory(), {
        planComplete: false,
        tracks: [],
        artistMaps: [],
        albumMaps: [],
      }),
    ).toMatchObject({
      ready: false,
      finished: false,
      users: null,
      independentData: null,
      recordings: { pending: 3, imported: 0, skipped: 0 },
      favorites: { pending: 3 },
      views: { pending: 2 },
      auxiliaryMaps: { artists: { pending: 1 }, albums: { pending: 1 } },
    });
  });

  it('requires metadata completion even when Processings and all maps are complete', () => {
    const saved = {
      ...destination(),
      artistMaps: [{ legacyId: 'artist', destinationId: 'canonical-artist' }],
      albumMaps: [{ legacyId: 'album', destinationId: 'canonical-album' }],
    };
    for (const row of saved.tracks.filter(
      (track) => track.status === 'planned',
    ))
      row.processingStatus = 'COMPLETED';
    const maps = {
      artists: {
        mapped: 1,
        unresolved: 0,
        pending: 0,
        unresolvedItems: [],
        pendingItems: [],
      },
      albums: {
        mapped: 1,
        unresolved: 0,
        pending: 0,
        unresolvedItems: [],
        pendingItems: [],
      },
    };
    expect(reconcileCutover(inventory(), saved, maps)).toMatchObject({
      ready: true,
      finished: false,
      metadataPending: 1,
      auxiliaryMaps: {
        artists: {
          items: [
            {
              legacyId: 'artist',
              destinationId: 'canonical-artist',
              reason: null,
            },
          ],
        },
      },
    });
    for (const row of saved.tracks.filter(
      (track) => track.status === 'planned',
    ))
      row.metadataStatus = 'completed';
    expect(reconcileCutover(inventory(), saved, maps)).toMatchObject({
      finished: true,
      processing: { pending: 0, completed: 1, failed: 0 },
    });
  });
});
