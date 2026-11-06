export type UserTrackSignal = {
  trackId: string;
  attempts: number;
  bestAccuracy: number;
  lastAttemptAt: Date;
  genres: string[];
  artistKey: string;
  title: string;
  coverUrl: string | null;
  artistCredit: { name: string; joinPhrase: string }[];
  durationMs: number | null;
  vocalRangeLowest: number | null;
  vocalRangeHighest: number | null;
};

export type UserFavoriteSignal = {
  trackId: string;
  genres: string[];
  artistKey: string;
  createdAt: Date;
};

export type UserTasteActivity = {
  trackId: string;
  genres: string[];
  artistKey: string;
  createdAt: Date;
};

export type PersonalTrackCandidate = {
  id: string;
  title: string;
  coverUrl: string | null;
  artistCredit: { name: string; joinPhrase: string; mbid?: string }[];
  durationMs: number | null;
  vocalRangeLowest: number | null;
  vocalRangeHighest: number | null;
  genres: string[];
  trendingScore: number;
};

export type PersonalAlbumTrack = PersonalTrackCandidate & { albumId: string };
