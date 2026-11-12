import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Uniwind } from 'uniwind';
import {
  type AppearancePreference,
  parseAppearancePreference,
} from './appearance-preference';

const appearanceStorageKey = 'vozzify.appearance';

type MobileAppearanceContextValue = {
  preference: AppearancePreference;
  ready: boolean;
  setPreference: (preference: AppearancePreference) => Promise<void>;
};

const MobileAppearanceContext =
  createContext<MobileAppearanceContextValue | null>(null);

async function loadStoredPreference() {
  try {
    return parseAppearancePreference(
      await AsyncStorage.getItem(appearanceStorageKey),
    );
  } catch {
    return 'system';
  }
}

type MobileAppearanceProviderProps = {
  children: ReactNode;
  initialPreference?: AppearancePreference;
};

export function MobileAppearanceProvider({
  children,
  initialPreference = 'system',
}: MobileAppearanceProviderProps) {
  const [preference, setPreferenceState] = useState(initialPreference);
  const [ready, setReady] = useState(false);
  const pendingWrites = useRef(Promise.resolve());
  const preferenceVersion = useRef(0);

  useEffect(() => {
    let mounted = true;

    async function restorePreference() {
      const restoredPreference = await loadStoredPreference();
      if (!mounted) {
        return;
      }
      if (preferenceVersion.current === 0) {
        Uniwind.setTheme(restoredPreference);
        setPreferenceState(restoredPreference);
      }
      setReady(true);
    }

    void restorePreference();
    return () => {
      mounted = false;
    };
  }, []);

  const setPreference = useCallback((nextPreference: AppearancePreference) => {
    preferenceVersion.current += 1;
    Uniwind.setTheme(nextPreference);
    setPreferenceState(nextPreference);
    const write = pendingWrites.current.then(() =>
      AsyncStorage.setItem(appearanceStorageKey, nextPreference),
    );
    pendingWrites.current = write.catch(() => undefined);
    return write;
  }, []);

  const value = useMemo(
    () => ({ preference, ready, setPreference }),
    [preference, ready, setPreference],
  );

  return (
    <MobileAppearanceContext.Provider value={value}>
      {children}
    </MobileAppearanceContext.Provider>
  );
}

export function useMobileAppearance() {
  const context = useContext(MobileAppearanceContext);
  if (context === null) {
    throw new Error(
      'useMobileAppearance must be used within MobileAppearanceProvider',
    );
  }
  return context;
}
