'use client';

import { useSearchParams } from 'next/navigation';
import { lazy, Suspense, useEffect, useState } from 'react';

const AnnouncementDialog = lazy(() =>
  import('./notefinder-dialog').then((module) => ({
    default: module.NotefinderDialog,
  })),
);

const dismissedKey = 'vozzify:notefinder-announcement-dismissed';

function Announcement() {
  const source = useSearchParams().get('from');
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let stored = false;
    try {
      stored = window.localStorage.getItem(dismissedKey) === 'true';
    } catch {
      // Blocked storage must not prevent visitors from reading the notice.
    }
    setOpen(source === 'notefinder' && !stored && !dismissed);
  }, [source, dismissed]);

  function dismiss() {
    setOpen(false);
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissedKey, 'true');
    } catch {
      // Keep the dismissal for this visit when storage is unavailable.
    }
  }

  return open ? <AnnouncementDialog onDismiss={dismiss} /> : null;
}

export function NotefinderAnnouncement() {
  return (
    <Suspense fallback={null}>
      <Announcement />
    </Suspense>
  );
}
