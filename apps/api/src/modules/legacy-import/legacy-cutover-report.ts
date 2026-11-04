import type { EntityMapReport } from './legacy-catalog-map-report.js';

export type CutoverInventory = {
  users: number;
  accounts: number;
  practiceDays: number;
  favorites: number;
  views: number;
  tracks: string[];
  artists: string[];
  albums: string[];
  errors: string[];
  favoriteRows?: { id: string; trackId: string }[];
  viewRows?: { id: string; trackId: string }[];
};

type TrackOutcome = {
  legacyId: string;
  recordingMbid: string | null;
  trackId: string | null;
  mappedTrackId: string | null;
  processingId: string | null;
  status: string;
  processingStatus: string | null;
  metadataStatus: string | null;
  reason: string | null;
};

export type CutoverDestination = {
  users?: { status: string; importedUsers: number; importedAccounts: number };
  personal?: { status: string; importedPracticeDays: number };
  planComplete: boolean;
  relationships?: {
    status: string;
    acceptedFavorites: number;
    importedFavorites: number;
    deduplicatedFavorites: number;
    importedViews: number;
    skippedFavorites: number;
    skippedViews: number;
  };
  tracks: TrackOutcome[];
  artistMaps: { legacyId: string; destinationId: string }[];
  albumMaps: { legacyId: string; destinationId: string }[];
};

type MapReports = { artists: EntityMapReport; albums: EntityMapReport };

/** Reconciles durable outcomes without treating queued or failed work as skips. */
export const reconcileCutover = (
  source: CutoverInventory,
  destination: CutoverDestination,
  maps?: MapReports,
) => {
  const { tracks, prepared, skipped, groups } = recordingOutcomes(
    source,
    destination,
  );
  const processing = processingCounts(groups);
  const relations = relationshipCounts(source, destination.relationships);
  const recordings = recordingSummary(prepared, groups, skipped, source);
  const identityComplete = usersComplete(source, destination.users);
  const ready =
    identityComplete &&
    destination.personal?.status === 'complete' &&
    destination.personal.importedPracticeDays === source.practiceDays &&
    destination.planComplete &&
    recordings.pending === 0 &&
    relations.complete;
  const auxiliaryMaps = auxiliaryReport(source, destination, maps);
  const metadataPending = groups.filter(
    (row) => row.metadataStatus !== 'completed',
  ).length;
  return {
    ready,
    identityComplete,
    finished:
      ready &&
      maps !== undefined &&
      processing.pending === 0 &&
      metadataPending === 0 &&
      auxiliaryMaps.artists.pending === 0 &&
      auxiliaryMaps.albums.pending === 0,
    source,
    processing,
    favorites: relations.favorites,
    views: relations.views,
    auxiliaryMaps,
    metadataPending,
    recordings,
    tracks,
    relationshipExclusions: {
      favorites: relationshipExclusions(source.favoriteRows ?? [], tracks),
      views: relationshipExclusions(source.viewRows ?? [], tracks),
    },
    users: destination.users ?? null,
    independentData: destination.personal ?? null,
  };
};

const auxiliaryReport = (
  source: CutoverInventory,
  destination: CutoverDestination,
  maps?: MapReports,
) => ({
  artists: auxiliaryOutcomes(
    source.artists,
    destination.artistMaps,
    maps?.artists,
  ),
  albums: auxiliaryOutcomes(source.albums, destination.albumMaps, maps?.albums),
});

const relationshipExclusions = (
  rows: { id: string; trackId: string }[],
  tracks: TrackOutcome[],
) =>
  rows.flatMap((row) => {
    const track = tracks.find((track) => track.legacyId === row.trackId);
    if (track?.status !== 'skipped' && track?.mappedTrackId) return [];
    return [
      {
        legacyId: row.id,
        legacyTrackId: row.trackId,
        destinationTrackId: null,
        status: track?.status === 'skipped' ? 'skipped' : 'pending',
        reason: track?.reason ?? 'track-map-pending',
      },
    ];
  });

const recordingOutcomes = (
  source: CutoverInventory,
  destination: CutoverDestination,
) => {
  const tracks = source.tracks.map(
    (legacyId) =>
      destination.tracks.find((row) => row.legacyId === legacyId) ?? {
        legacyId,
        status: 'pending',
        reason: 'recording-not-planned',
        trackId: null,
        mappedTrackId: null,
        processingId: null,
        recordingMbid: null,
        processingStatus: null,
        metadataStatus: null,
      },
  );
  const outcomes = tracks.map((row) => ({ ...row }));
  for (const row of outcomes) {
    if (row.status !== 'planned') continue;
    if (!row.trackId) row.reason = 'recording-not-prepared';
    else if (row.mappedTrackId !== row.trackId)
      row.reason = 'track-map-pending';
    else if (!row.processingId) row.reason = 'processing-not-prepared';
  }
  const prepared = outcomes.filter(
    (row) =>
      row.status === 'planned' &&
      row.recordingMbid &&
      row.trackId &&
      row.trackId === row.mappedTrackId &&
      row.processingId,
  );
  const skipped = outcomes.filter(
    (row) =>
      row.status === 'skipped' && row.reason && row.recordingMbid === null,
  );
  const groups = [
    ...new Map(prepared.map((row) => [row.recordingMbid, row])).values(),
  ];
  return { tracks: outcomes, prepared, skipped, groups };
};

const recordingSummary = (
  prepared: TrackOutcome[],
  groups: TrackOutcome[],
  skipped: TrackOutcome[],
  source: CutoverInventory,
) => {
  return {
    imported: groups.length,
    duplicateGroups: groups.filter(
      (group) =>
        prepared.filter((row) => row.recordingMbid === group.recordingMbid)
          .length > 1,
    ).length,
    duplicateTracks: prepared.length - groups.length,
    skipped: skipped.length,
    pending: source.tracks.length - prepared.length - skipped.length,
  };
};

const usersComplete = (
  source: CutoverInventory,
  users: CutoverDestination['users'],
) =>
  source.errors.length === 0 &&
  users?.status === 'complete' &&
  users.importedUsers === source.users &&
  users.importedAccounts === source.accounts;

const processingCounts = (groups: TrackOutcome[]) => ({
  pending: groups.filter(
    (row) =>
      row.processingStatus !== 'COMPLETED' && row.processingStatus !== 'FAILED',
  ).length,
  completed: groups.filter((row) => row.processingStatus === 'COMPLETED')
    .length,
  failed: groups.filter((row) => row.processingStatus === 'FAILED').length,
});

const relationshipCounts = (
  source: CutoverInventory,
  saved: CutoverDestination['relationships'],
) => {
  const favorites = {
    source: source.favorites,
    retained: saved?.importedFavorites ?? 0,
    deduplicated: saved?.deduplicatedFavorites ?? 0,
    skipped: saved?.skippedFavorites ?? 0,
    pending:
      source.favorites -
      (saved?.acceptedFavorites ?? 0) -
      (saved?.skippedFavorites ?? 0),
  };
  const views = {
    source: source.views,
    imported: saved?.importedViews ?? 0,
    skipped: saved?.skippedViews ?? 0,
    pending:
      source.views - (saved?.importedViews ?? 0) - (saved?.skippedViews ?? 0),
  };
  const complete =
    saved?.status === 'complete' &&
    favorites.pending === 0 &&
    views.pending === 0 &&
    favorites.retained + favorites.deduplicated === saved.acceptedFavorites;
  return { favorites, views, complete };
};

const auxiliaryOutcomes = (
  sourceIds: string[],
  mappings: { legacyId: string; destinationId: string }[],
  report?: EntityMapReport,
) => {
  const skips = new Map(
    report?.unresolvedItems.map((item) => [item.legacyId, item.reason]),
  );
  const pending = new Map(
    report?.pendingItems.map((item) => [item.legacyId, item.reason]),
  );
  const rows = sourceIds.map((legacyId) => {
    const destinationId =
      mappings.find((mapping) => mapping.legacyId === legacyId)
        ?.destinationId ?? null;
    return {
      legacyId,
      destinationId,
      status: destinationId
        ? 'mapped'
        : skips.has(legacyId)
          ? 'skipped'
          : 'pending',
      reason: destinationId
        ? null
        : (skips.get(legacyId) ??
          pending.get(legacyId) ??
          'reconciliation-required'),
    };
  });
  return {
    mapped: rows.filter((row) => row.status === 'mapped').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    pending: rows.filter((row) => row.status === 'pending').length,
    items: rows,
  };
};
