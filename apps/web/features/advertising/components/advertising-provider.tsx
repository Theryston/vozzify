'use client';

import type { ReactNode } from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { SessionUserBoundary } from '@/features/auth/components/session-user';
import { SubscriptionAdEligibility } from '@/features/plans/components/subscription-ad-eligibility';
import type { AdsenseConfig } from '@/lib/env/adsense-config';
import {
  loadAdSense,
  loadCmp,
  pauseAdSenseRequests,
  resumeAdSenseRequests,
  subscribeToTcfChoice,
} from '../ad-runtime';
import type { AdConsent } from '../consent';

const AdPermissionContext = createContext(false);

export function AdvertisingProvider({
  children,
  config,
}: {
  children: ReactNode;
  config?: AdsenseConfig;
}) {
  if (!config) return children;
  return (
    <SessionUserBoundary
      render={(user, loading, failed) => {
        return (
          <PermissionContext
            config={config}
            user={user}
            sessionKnown={!loading && !failed}
          >
            {children}
          </PermissionContext>
        );
      }}
    />
  );
}

function PermissionContext({
  config,
  user,
  sessionKnown,
  children,
}: {
  config: AdsenseConfig;
  user: { id?: string } | null;
  sessionKnown: boolean;
  children: ReactNode;
}) {
  const [tagReady, setTagReady] = useState(false);
  const [consent, setConsent] = useState<AdConsent>();

  return (
    <AdPermissionContext.Provider
      value={
        sessionKnown &&
        tagReady &&
        consent !== undefined &&
        consent !== 'denied'
      }
    >
      {!sessionKnown ? null : user?.id ? (
        <SubscriptionAdEligibility
          userId={user.id}
          render={(eligible) =>
            eligible ? (
              <ConsentListener
                config={config}
                onPermissionChange={setTagReady}
                onConsentChange={setConsent}
                consent={consent}
              />
            ) : null
          }
        />
      ) : user ? null : (
        <ConsentListener
          config={config}
          onPermissionChange={setTagReady}
          onConsentChange={setConsent}
          consent={consent}
        />
      )}
      {children}
    </AdPermissionContext.Provider>
  );
}

function ConsentListener({
  config,
  onPermissionChange,
  onConsentChange,
  consent,
}: {
  config: AdsenseConfig;
  onPermissionChange: (allowed: boolean) => void;
  onConsentChange: (consent: AdConsent | undefined) => void;
  consent: AdConsent | undefined;
}) {
  const activeRef = useRef(true);
  const generationRef = useRef(0);
  useCmpListener(config, activeRef, onPermissionChange, onConsentChange);
  useAdProvider({
    config,
    consent,
    activeRef,
    generationRef,
    onPermissionChange,
    onConsentChange,
  });
  useConsentCleanup(activeRef, onPermissionChange, onConsentChange);
  return null;
}

function useCmpListener(
  config: AdsenseConfig,
  activeRef: React.RefObject<boolean>,
  onPermissionChange: (allowed: boolean) => void,
  onConsentChange: (consent: AdConsent | undefined) => void,
) {
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void loadCmp(config)
      .then((api) => {
        if (!active || !activeRef.current) return;
        unsubscribe = subscribeToTcfChoice(api, (choice) => {
          if (!active || !activeRef.current) return;
          onConsentChange(choice);
        });
      })
      .catch(() => {
        if (active && activeRef.current) onConsentChange('denied');
      });
    return () => {
      active = false;
      unsubscribe?.();
      onPermissionChange(false);
      onConsentChange(undefined);
    };
  }, [activeRef, config, onConsentChange, onPermissionChange]);
}

function useAdProvider({
  config,
  consent,
  activeRef,
  generationRef,
  onPermissionChange,
  onConsentChange,
}: {
  config: AdsenseConfig;
  consent: AdConsent | undefined;
  activeRef: React.RefObject<boolean>;
  generationRef: React.RefObject<number>;
  onPermissionChange: (allowed: boolean) => void;
  onConsentChange: (consent: AdConsent | undefined) => void;
}) {
  useEffect(() => {
    const generation = ++generationRef.current;
    let active = true;
    if (!consent)
      return () => {
        active = false;
      };
    if (consent === 'denied') {
      pauseAdSenseRequests();
      onPermissionChange(false);
      return () => {
        active = false;
      };
    }
    onPermissionChange(false);
    void loadAdSense(config, consent)
      .then(() => {
        if (
          !active ||
          !activeRef.current ||
          generation !== generationRef.current
        )
          return;
        resumeAdSenseRequests();
        onPermissionChange(true);
      })
      .catch(() => {
        if (!active || generation !== generationRef.current) return;
        onPermissionChange(false);
        onConsentChange('denied');
      });
    return () => {
      active = false;
      generationRef.current += 1;
      pauseAdSenseRequests();
    };
  }, [
    activeRef,
    config,
    consent,
    generationRef,
    onConsentChange,
    onPermissionChange,
  ]);
}

function useConsentCleanup(
  activeRef: React.RefObject<boolean>,
  onPermissionChange: (allowed: boolean) => void,
  onConsentChange: (consent: AdConsent | undefined) => void,
) {
  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      pauseAdSenseRequests();
      onPermissionChange(false);
      onConsentChange(undefined);
    };
  }, [activeRef, onConsentChange, onPermissionChange]);
}

export function useAdPermission(): boolean {
  return useContext(AdPermissionContext);
}
