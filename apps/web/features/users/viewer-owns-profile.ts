import 'server-only';

import { getCurrentUser } from '@/lib/auth/session';

/**
 * Whether the signed-in viewer owns the Profile of `username`: only the owner
 * sees a section they hid or private practice in their history. Reads the
 * request, so call it inside `<Suspense>`.
 */
export async function viewerOwnsProfile(username: string): Promise<boolean> {
  const viewer = await getCurrentUser();
  return viewer !== null && viewer.username === username;
}
