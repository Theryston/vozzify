export type EntityMapReport = {
  mapped: number;
  unresolved: number;
  pending: number;
  unresolvedItems: { legacyId: string; reason: string }[];
  pendingItems: { legacyId: string; reason: string }[];
};

export const emptyReport = (): EntityMapReport => ({
  mapped: 0,
  unresolved: 0,
  pending: 0,
  unresolvedItems: [],
  pendingItems: [],
});

export const addUnresolved = (
  report: EntityMapReport,
  legacyId: string,
  reason: string,
): void => {
  report.unresolved += 1;
  report.unresolvedItems.push({ legacyId, reason });
};

export const addPending = (
  report: EntityMapReport,
  legacyId: string,
  reason: string,
): void => {
  report.pending += 1;
  report.pendingItems.push({ legacyId, reason });
};

export const pendingReason = (
  occurrences: { trackId: string | null; metadataStatus: string | null }[],
): string =>
  occurrences.some((item) => item.trackId === null)
    ? 'recording-not-imported'
    : occurrences.some((item) => item.metadataStatus === 'failed')
      ? 'metadata-import-failed'
      : 'metadata-import-pending';

export const namesAgree = (occurrences: { name: string }[]): boolean =>
  new Set(
    occurrences.map((item) =>
      item.name.normalize('NFC').trim().toLocaleLowerCase('en'),
    ),
  ).size === 1;
