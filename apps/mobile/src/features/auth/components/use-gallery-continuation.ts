import { usePathname } from 'expo-router';
import { useEffect } from 'react';
import { useMobileAuth } from '../../../lib/auth/mobile-auth-provider';

export function useGalleryContinuation(openOverlay: () => void) {
  const path = usePathname();
  const auth = useMobileAuth();

  useEffect(() => {
    if (
      path !== '/components' ||
      !auth.user?.emailVerified ||
      !auth.user.username
    ) {
      return;
    }
    if (auth.continuation?.destination !== '/components') return;
    void auth.consumeContinuation().then((continuation) => {
      if (
        continuation?.destination === '/components' &&
        continuation.action === 'open-overlay'
      ) {
        openOverlay();
      }
    });
  }, [auth, openOverlay, path]);
}
