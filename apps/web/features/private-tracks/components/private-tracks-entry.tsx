'use client';

import dynamic from 'next/dynamic';
import { PrivateTracksLoading } from './private-tracks-frame';

// The authenticated library needs media controls and API schemas only after
// hydration. The localized page frame can render before that bundle loads.
export const PrivateTracksEntry = dynamic(
  () =>
    import('./private-tracks-content').then(
      (module) => module.PrivateTracksContent,
    ),
  { ssr: false, loading: PrivateTracksLoading },
);
