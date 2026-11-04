import type { Recording, RecordingSummary } from '@vozzify/contracts';
import type { LegacyTrack } from './legacy-recording.js';

export type RecordingMatch = {
  recording: Recording;
  score: number;
  rationale: string;
};

const ACOUSTIC_MARKERS = ['acoustic', 'unplugged'];
const ACOUSTIC_VERSION_SUFFIX =
  /(?:\((?:acoustic|unplugged)(?:\s+version)?\)|[-–—]\s*(?:acoustic|unplugged)(?:\s+version)?|\b(?:acoustic|unplugged)\s+version)$/iu;

const normalize = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const normalizeTitle = (value: string): string =>
  normalize(
    value
      .replace(
        /\s*\((acoustic|live|unplugged|remix|karaoke)(\s+version)?\)/giu,
        ' ',
      )
      .replace(
        /\s*-\s*(acoustic|live|unplugged|remix|karaoke|official video|official audio|lyric video)(\s+version)?$/giu,
        ' ',
      ),
  );

const hasMarker = (value: string, markers: readonly string[]): boolean => {
  const normalized = normalize(value);
  return markers.some((marker) => normalized.includes(marker));
};

const isAcousticRecording = (recording: Recording): boolean =>
  ACOUSTIC_VERSION_SUFFIX.test(recording.title) ||
  hasMarker(
    [recording.disambiguation, ...recording.tags.map((tag) => tag.name)].join(
      ' ',
    ),
    ACOUSTIC_MARKERS,
  );

const artistEvidence = (track: LegacyTrack, recording: Recording): boolean => {
  const expected = track.artists.map((artist) => normalize(artist.name));
  if (expected.length === 0) return false;
  const actual = recording.artistCredit.artists.map((artist) =>
    normalize(artist.creditedName),
  );
  return expected.every((name) => actual.some((credit) => credit === name));
};

/** Filters search summaries before the more expensive full Recording lookup. */
export function summaryCouldMatch(
  track: LegacyTrack,
  summary: RecordingSummary,
): boolean {
  if (track.title === null) return false;
  const title = normalizeTitle(track.title);
  if (title === '' || title !== normalizeTitle(summary.title)) return false;
  const expectedArtists = track.artists.map((artist) => normalize(artist.name));
  if (expectedArtists.length === 0) return track.ytId !== null;
  const credit = normalize(summary.artistCredit);
  return expectedArtists.every((artist) => credit.includes(artist));
}

const durationEvidence = (
  track: LegacyTrack,
  recording: Recording,
): boolean => {
  const sourceDuration =
    track.durationSeconds ?? secondsFromDuration(track.duration);
  if (sourceDuration === null || recording.lengthMs === null) return false;
  const seconds = recording.lengthMs / 1000;
  return (
    Math.abs(sourceDuration - seconds) <= Math.max(10, sourceDuration * 0.05)
  );
};

const secondsFromDuration = (duration: string | null): number | null => {
  if (
    duration === null ||
    !/^[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?$/.test(duration)
  )
    return null;
  const parts = duration.split(':').map(Number);
  return parts.length === 2
    ? (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
    : (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
};

const youtubeEvidence = (track: LegacyTrack, recording: Recording): boolean => {
  if (track.ytId === null) return false;
  return recording.externalUrls.some(
    (external) => youtubeIdFromUrl(external.url) === track.ytId,
  );
};

const youtubeIdFromUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase('en');
    if (host === 'youtu.be') return url.pathname.slice(1).split('/')[0] ?? null;
    if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return null;
    if (url.pathname === '/watch') return url.searchParams.get('v');
    const [, , id] = url.pathname.split('/');
    return ['embed', 'shorts', 'live'].includes(
      url.pathname.split('/')[1] ?? '',
    )
      ? (id ?? null)
      : null;
  } catch {
    return null;
  }
};

/**
 * Scores candidates using independent metadata. A title match alone never
 * qualifies, and a known acoustic candidate cannot replace a studio source.
 */
export function matchLegacyTrack(
  track: LegacyTrack,
  recording: Recording,
): RecordingMatch | null {
  if (track.title === null) return null;
  const normalizedSourceTitle = normalizeTitle(track.title);
  const normalizedRecordingTitle = normalizeTitle(recording.title);
  if (
    normalizedSourceTitle === '' ||
    normalizedRecordingTitle === '' ||
    normalizedSourceTitle !== normalizedRecordingTitle
  )
    return null;

  const exactYoutube = youtubeEvidence(track, recording);
  const artistsMatch = artistEvidence(track, recording);
  const durationMatches = durationEvidence(track, recording);
  if (!exactYoutube && (!artistsMatch || !durationMatches)) return null;

  if (
    !ACOUSTIC_VERSION_SUFFIX.test(track.title) &&
    isAcousticRecording(recording)
  ) {
    return null;
  }

  const albumMatches =
    track.albumName !== null &&
    recording.releases.some(
      (release) =>
        normalize(release.title) === normalize(track.albumName ?? ''),
    );
  const score =
    50 +
    Number(artistsMatch) * 20 +
    Number(durationMatches) * 20 +
    Number(albumMatches) * 5 +
    Number(exactYoutube) * 100;
  const evidence = [
    'title',
    ...(artistsMatch ? ['artist-credit'] : []),
    ...(durationMatches ? ['duration'] : []),
    ...(albumMatches ? ['album-context'] : []),
    ...(exactYoutube ? ['youtube-identity'] : []),
  ];
  return { recording, score, rationale: evidence.join(',') };
}

/** Stable score then MBID order makes catalog search ordering irrelevant. */
export function chooseRecordingMatch(
  matches: readonly RecordingMatch[],
): RecordingMatch | null {
  return (
    [...matches].sort(
      (left, right) =>
        right.score - left.score ||
        left.recording.mbid.localeCompare(right.recording.mbid),
    )[0] ?? null
  );
}
