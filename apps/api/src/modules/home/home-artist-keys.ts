/** Canonical Artist identity for internal ranking; these keys never leave the API. */
export const homeArtistKeys = (
  credits: readonly { name: string; mbid?: string; artistId?: string | null }[],
  fallback: string,
): string[] => {
  const keys = [
    ...new Set(
      credits.map(
        ({ name, mbid, artistId }) =>
          mbid?.trim() || artistId?.trim() || name.trim().toLowerCase(),
      ),
    ),
  ].filter(Boolean);
  return keys.length > 0 ? keys : [fallback];
};
