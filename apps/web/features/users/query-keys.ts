/**
 * TanStack Query keys for the Profile's favorite songs grid. One infinite key
 * per Profile plus page size; the cursor travels as the page param, so every
 * page of one Profile shares the key and the cache stays per Profile.
 */
export const profileKeys = {
  all: ['users'] as const,
  favorites: (username: string) =>
    [...profileKeys.all, username, 'favorites'] as const,
  infiniteFavorites: (username: string, limit: number) =>
    [...profileKeys.favorites(username), 'infinite', { limit }] as const,
  /** The signed-in owner's section flags (`GET /v1/me/profile-visibility`). */
  visibility: () => [...profileKeys.all, 'me', 'profile-visibility'] as const,
  /** What the signed-in viewer has with the Profile's User (`isFollowing`). */
  follow: (username: string) =>
    [...profileKeys.all, username, 'follow'] as const,
  /** The follow counts shown under the banner, kept fresh after a follow. */
  counts: (username: string) =>
    [...profileKeys.all, username, 'counts'] as const,
  /** One infinite follow list (followers, following or friends) of a Profile. */
  followList: (username: string, side: 'followers' | 'following' | 'friends') =>
    [...profileKeys.all, username, 'follow-list', side] as const,
};

/** The cache key of a Profile's practice history; the cursor travels as the page param. */
export const practiceHistoryKey = (username: string, owner = false) => {
  const key = ['users', username, 'practice-history'] as const;
  return owner ? ([...key, 'owner'] as const) : key;
};
