import { createContext, type ReactNode, useContext } from 'react';

const FontAvailabilityContext = createContext(true);

type FontAvailabilityProviderProps = {
  available: boolean;
  children: ReactNode;
};

export function FontAvailabilityProvider({
  available,
  children,
}: FontAvailabilityProviderProps) {
  return (
    <FontAvailabilityContext.Provider value={available}>
      {children}
    </FontAvailabilityContext.Provider>
  );
}

export function useCustomFontsAvailable() {
  return useContext(FontAvailabilityContext);
}
