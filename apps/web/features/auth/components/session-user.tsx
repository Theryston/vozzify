'use client';

import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useSyncExternalStore } from 'react';

import { type SessionUser, sessionUserOptions } from '../session';

const subscribeNever = () => () => {};

/**
 * Renders with the signed-in user, or `null` while the session is loading or
 * when nobody is signed in (`loading` tells the two apart, for what must not
 * flash a visitor's view at a signed-in user). Lets another feature offer
 * signed-in actions without importing the session query, which belongs to the
 * auth feature.
 */
export function SessionUserBoundary({
  render,
}: {
  render: (
    user: SessionUser | null,
    loading: boolean,
    failed: boolean,
  ) => ReactNode;
}) {
  const session = useQuery(sessionUserOptions());
  // The server never knows the session, and the query may already hold it when
  // this hydrates (the header asked first). The first client render must match
  // the server's, so it reads "loading" until hydration is done.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  if (!hydrated) return render(null, true, false);
  return render(session.data ?? null, session.isPending, session.isError);
}
