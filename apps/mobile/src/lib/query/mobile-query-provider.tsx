import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { connectQueryLifecycle } from './query-lifecycle';

type MobileQueryProviderProps = { children: ReactNode };

function createMobileQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 30_000 },
      mutations: { retry: 0 },
    },
  });
}

export function MobileQueryProvider({ children }: MobileQueryProviderProps) {
  const [queryClient] = useState(createMobileQueryClient);
  const lifecycleGeneration = useRef(0);

  useEffect(() => {
    const generation = ++lifecycleGeneration.current;
    const disconnect = connectQueryLifecycle();
    return () => {
      disconnect();
      onlineManager.setEventListener(() => () => undefined);
      setTimeout(() => {
        if (lifecycleGeneration.current === generation) queryClient.clear();
      }, 0);
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
