'use client';

import dynamic from 'next/dynamic';

import { SessionUserBoundary } from '@/features/auth/components/session-user';

const PrivateTracksContent = dynamic(
  () =>
    import('./private-tracks-content').then(
      (module) => module.PrivateTracksContent,
    ),
  { ssr: false },
);

export function PrivateTracks() {
  return (
    <SessionUserBoundary
      render={(user, loading) => (
        <PrivateTracksContent user={user} loading={loading} />
      )}
    />
  );
}
