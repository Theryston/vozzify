const COVER_ART_ARCHIVE = 'https://assets.vozzify.com/cover-art-archive';

/**
 * The Cover Art Archive URL of a release's front cover, a 500 px image: big
 * enough for an album cover on screen, light enough for a list. It is built
 * from the release MBID alone, because the catalog does not know which
 * releases have art (the `cover_art` table is never loaded: neither the
 * full dumps nor the `tiny` seed carry cover-art data), so the URL may answer 404. Other sizes: replace `500` with `250`
 * or `1200`, or drop the suffix for the original image.
 */
export const coverArtUrl = (releaseMbid: string): string =>
  `${COVER_ART_ARCHIVE}/release/${releaseMbid}/front-500`;

/**
 * The same front cover, 500 px, for a release group (an album across its
 * editions). Like {@link coverArtUrl}, built from the MBID alone.
 */
export const releaseGroupCoverArtUrl = (releaseGroupMbid: string): string =>
  `${COVER_ART_ARCHIVE}/release-group/${releaseGroupMbid}/front-500`;
