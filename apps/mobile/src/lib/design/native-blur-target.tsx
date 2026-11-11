import type { ComponentRef, RefObject } from 'react';
import { createContext, type ReactNode, useContext } from 'react';
import type { View } from 'react-native';

type NativeBlurTargetRef = RefObject<ComponentRef<typeof View> | null>;

const NativeBlurTargetContext = createContext<NativeBlurTargetRef | null>(null);

type NativeBlurTargetProviderProps = {
  targetRef: NativeBlurTargetRef;
  children: ReactNode;
};

export function NativeBlurTargetProvider({
  targetRef,
  children,
}: NativeBlurTargetProviderProps) {
  return (
    <NativeBlurTargetContext.Provider value={targetRef}>
      {children}
    </NativeBlurTargetContext.Provider>
  );
}

export function useNativeBlurTarget() {
  return useContext(NativeBlurTargetContext);
}
