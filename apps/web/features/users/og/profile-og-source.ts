import 'server-only';

import type { PublicProfile } from '@vozzify/contracts';

import { getPublicProfile } from '@/features/users/queries';

/**
 * The only fields a Profile's preview image may show: the banner and the three
 * public chips. Picked one by one, so a section the API ever adds to the
 * response (counts, history, favorites: hideable by their owner) cannot reach
 * the image or its metadata.
 */
export type ProfileOgSource = Pick<
  PublicProfile,
  | 'username'
  | 'name'
  | 'image'
  | 'avatarIdentity'
  | 'dailyPracticeTargetSeconds'
  | 'vocalRange'
  | 'mostSungArtist'
>;

/**
 * The banner the preview image is drawn from, or `null` for an unknown
 * username or an API that cannot answer (the image route then answers 404,
 * the same as the page). Reads the banner alone, through the same cached
 * fetcher as the page, so it shares its tag and costs no extra request.
 */
export async function getProfileOgSource(
  username: string,
): Promise<ProfileOgSource | null> {
  const profile = await getPublicProfile(username).catch(() => null);
  if (profile === null) {
    return null;
  }
  return {
    username: profile.username,
    name: profile.name,
    image: profile.image,
    avatarIdentity: profile.avatarIdentity,
    dailyPracticeTargetSeconds: profile.dailyPracticeTargetSeconds,
    vocalRange: profile.vocalRange,
    mostSungArtist: profile.mostSungArtist,
  };
}
