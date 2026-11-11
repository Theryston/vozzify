import { focusManager, onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';

function isOnline(state: Network.NetworkState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

export function connectQueryLifecycle(): () => void {
  const appStateSubscription = AppState.addEventListener(
    'change',
    (state: AppStateStatus) => focusManager.setFocused(state === 'active'),
  );
  onlineManager.setEventListener((setOnline) => {
    let active = true;
    let receivedNetworkEvent = false;
    void Network.getNetworkStateAsync()
      .then((state) => {
        if (active && !receivedNetworkEvent) setOnline(isOnline(state));
      })
      .catch(() => {
        if (active && !receivedNetworkEvent) setOnline(false);
      });
    const networkSubscription = Network.addNetworkStateListener((state) => {
      receivedNetworkEvent = true;
      setOnline(isOnline(state));
    });
    return () => {
      active = false;
      if (typeof networkSubscription?.remove === 'function') {
        networkSubscription.remove();
      }
    };
  });
  focusManager.setFocused(AppState.currentState === 'active');
  return () => appStateSubscription.remove();
}
