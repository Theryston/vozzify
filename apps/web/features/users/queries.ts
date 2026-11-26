import 'server-only';

import {
  cacheTags,
  type ProfileVisibility,
  type PublicProfile,
  type PublicProfileSummary,
  profileVisibilitySchema,
  publicProfileSchema,
  publicProfileSummarySchema,
  type UserFavoritesPage,
  userFavoritesPageSchema,
} from '@vozzify/contracts';
import { cacheLife, cacheTag } from 'next/cache';

import { isApiError } from '@/lib/api/api-error';
import { serverApi } from '@/lib/api/server';

/**
 * The public banner of a Profile, cached under the Profile tag the API
 * revalidates when the Name or Avatar changes. An unknown username is `null`
 * rather than an error: the page answers it with a 404. The bounded life
 * also refreshes membership and role independently of profile edits.
 */
export async function getPublicProfile(
  username: string,
): Promise<PublicProfile | null> {
  'use cache';
  cacheTag(cacheTags.userProfile(username));
  cacheLife({ stale: 30, revalidate: 60, expire: 300 });

  try {
    return await serverApi(`/users/${encodeURIComponent(username)}`, {
      schema: publicProfileSchema,
    });
  } catch (error) {
    if (isApiError(error) && error.code === 'NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

/**
 * Which sections of a Profile visitors see, read to lay out the first paint:
 * a hidden section gets no skeleton. Cached under the Profile tag, which the
 * API revalidates when the owner changes a section. Only the flags come back,
 * no data. `null` for an unknown username.
 */
export async function getPublicSectionVisibility(
  username: string,
): Promise<ProfileVisibility | null> {
  'use cache';
  cacheTag(cacheTags.userProfile(username));
  cacheLife('max');

  return nullWhenNotFound(
    serverApi(`/users/${encodeURIComponent(username)}/sections`, {
      schema: profileVisibilitySchema,
    }),
  );
}

/**
 * The first page of a Profile's favorite Tracks, cached under its own favorites
 * tag (the API revalidates it when a favorite changes), so banner edits and
 * favorite changes do not evict each other. Later pages are read by the grid.
 * `null` when the owner hid the section: a visitor is never sent its data.
 */
export async function getPublicFavoritesPage(
  username: string,
): Promise<UserFavoritesPage | null> {
  'use cache';
  cacheTag(cacheTags.userFavorites(username));
  cacheLife('max');

  return nullWhenNotFound(
    serverApi(`/users/${encodeURIComponent(username)}/favorites`, {
      schema: userFavoritesPageSchema,
    }),
  );
}

/**
 * The first favorites page as the signed-in owner reads it: the request's
 * cookies identify the owner, so a section the owner hid comes back too. Not
 * cached (it depends on the viewer). Reads the request.
 */
export function getOwnFavoritesPage(
  username: string,
): Promise<UserFavoritesPage | null> {
  return nullWhenNotFound(
    serverApi(`/users/${encodeURIComponent(username)}/favorites`, {
      schema: userFavoritesPageSchema,
      forwardCookies: true,
    }),
  );
}

/**
 * The Summary numbers of a Profile. Read on every request rather than cached:
 * they move with each practice run, favorite and contribution, and no cache
 * tag covers those yet. An unknown username, or a section the owner hid, is
 * `null`.
 */
export async function getPublicProfileSummary(
  username: string,
): Promise<PublicProfileSummary | null> {
  return nullWhenNotFound(
    serverApi(`/users/${encodeURIComponent(username)}/summary`, {
      schema: publicProfileSummarySchema,
    }),
  );
}

/** The Summary numbers as the signed-in owner reads them (see `getOwnFavoritesPage`). */
export function getOwnPublicProfileSummary(
  username: string,
): Promise<PublicProfileSummary | null> {
  return nullWhenNotFound(
    serverApi(`/users/${encodeURIComponent(username)}/summary`, {
      schema: publicProfileSummarySchema,
      forwardCookies: true,
    }),
  );
}

/**
 * The API's `NOT_FOUND` as `null`: an unknown username, or a section hidden
 * from the caller. Any other failure is the caller's to handle.
 */
async function nullWhenNotFound<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (isApiError(error) && error.code === 'NOT_FOUND') {
      return null;
    }
    throw error;
  }
}
