import { queryOptions } from '@tanstack/react-query';
import type { AvatarIdentity } from '@vozzify/contracts';

import { authKeys } from './query-keys';

/** What the auth screens and the gate need to know about the user. */
export type SessionUser = {
  avatarIdentity?: AvatarIdentity;
  id?: string;
  role?: 'ADMIN' | 'USER';
  name: string;
  email: string;
  emailVerified: boolean;
  username: string | null;
  /** Photo URL (Google sign-ups bring one), when there is one. */
  image?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * The user in Better Auth's `get-session` answer (`{ session, user }`, or
 * `null` when signed out). Parsed by hand: this runs on every page, and Zod
 * would weigh on all of them.
 */
export function parseSessionUser(body: unknown): SessionUser | null {
  if (!isRecord(body) || !isRecord(body.user)) return null;
  const { id, name, email, emailVerified, username, image } = body.user;
  if (typeof email !== 'string') return null;
  return {
    ...(typeof id === 'string' && id ? { id } : {}),
    ...(body.user.role === 'ADMIN' || body.user.role === 'USER'
      ? { role: body.user.role }
      : {}),
    name: typeof name === 'string' ? name : '',
    email,
    emailVerified: emailVerified === true,
    username: typeof username === 'string' && username ? username : null,
    image: typeof image === 'string' && image ? image : undefined,
  };
}

/**
 * The signed-in user, or `null` when signed out. A plain request instead of
 * the Better Auth client, so every page can afford it after load.
 */
export async function fetchSessionUser(
  signal?: AbortSignal,
): Promise<SessionUser | null> {
  const { getClientEnv } = await import('@/lib/env/client');
  const apiUrl = getClientEnv().NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  const response = await fetch(`${apiUrl}/v1/auth/get-session`, {
    credentials: 'include',
    signal,
  });
  if (!response.ok) {
    throw new Error(`Session lookup failed (${response.status})`);
  }
  return parseSessionUser(await response.json());
}

export function sessionUserOptions() {
  return queryOptions({
    queryKey: authKeys.session(),
    queryFn: ({ signal }) => fetchSessionUser(signal),
    // Once per page load is enough; auth screens update it after changes.
    staleTime: 5 * 60_000,
    retry: false,
  });
}
