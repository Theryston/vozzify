import { ImageResponse } from 'next/og';
import { connection } from 'next/server';
import { initials } from '@/features/auth/initials';
import { loadProfileOgAvatar } from '@/features/users/og/profile-og-avatar';
import { profileOgCard } from '@/features/users/og/profile-og-card';
import { loadProfileOgFonts } from '@/features/users/og/profile-og-fonts';
import { profileOgIdentity } from '@/features/users/og/profile-og-identity';
import {
  PROFILE_OG_HEIGHT,
  PROFILE_OG_WIDTH,
  profileOgImage,
} from '@/features/users/og/profile-og-image';
import { getProfileOgSource } from '@/features/users/og/profile-og-source';
import { profileChipCopy } from '@/features/users/profile-chip-copy';
import type { Locale } from '@/lib/i18n/routing';

type UserRouteParams = { locale: Locale; username: string };

/**
 * The preview image of a Profile, linked from the page's `og:image` and
 * `twitter:image` by Next. It is drawn for each request (`connection()`):
 * there is no username to draw at build time, and the banner is read through
 * its cache tag, so a Name or Avatar change shows up here too.
 *
 * It draws the card from the public banner only (see `getProfileOgSource`).
 * An unknown Profile, or an API that cannot answer, is a 404: no preview,
 * the same as the page. The Avatar is fetched here, not in the page, so a
 * slow photo host never delays the page.
 */
export default async function ProfileOgImage({
  params,
}: {
  params: Promise<UserRouteParams>;
}) {
  await connection();
  const { locale, username } = await params;
  const source = await getProfileOgSource(username);
  if (source === null) {
    return new Response('Not found', { status: 404 });
  }

  const [{ messages }, avatar, fonts, identity] = await Promise.all([
    profileChipCopy(locale),
    loadProfileOgAvatar(source.image),
    loadProfileOgFonts(),
    profileOgIdentity(source.avatarIdentity, locale),
  ]);
  const card = profileOgCard({
    source,
    identity,
    messages,
    avatar,
    initials: initials(source.name, source.username),
  });

  return new ImageResponse(profileOgImage(card), {
    width: PROFILE_OG_WIDTH,
    height: PROFILE_OG_HEIGHT,
    fonts,
    headers: {
      'Cache-Control': 'public, max-age=0, s-maxage=60',
    },
  });
}
