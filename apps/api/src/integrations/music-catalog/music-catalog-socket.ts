import WebSocket from 'ws';
import { AppException } from '../../common/errors/app-exception.js';

const CONNECT_TIMEOUT_MS = 2_000;
export const MUSIC_CATALOG_SEARCH_TIMEOUT_MS = 2_000;

export async function connectMusicCatalog(
  url: string,
  key: string,
  onAuthenticationFailure: (message: string) => void,
  onSocketCreated: (socket: WebSocket) => void,
): Promise<WebSocket> {
  const socket = new WebSocket(url, {
    headers: { Authorization: `Bearer ${key}` },
  });
  onSocketCreated(socket);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.once('error', () => undefined);
      socket.terminate();
      reject(new Error('Music catalog connection timed out'));
    }, CONNECT_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('open', onOpen);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      if (
        /Unexpected server response: 401|Unexpected server response: 403/.test(
          error.message,
        )
      ) {
        onAuthenticationFailure(error.message);
      }
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('Connection closed'));
    };
    socket.once('open', onOpen);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
  return socket;
}

export function waitForConnection(
  promise: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppException('GATEWAY_TIMEOUT', 'Music catalog request timed out'),
      );
    }, timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export const notConnected = (): AppException =>
  new AppException('SERVICE_UNAVAILABLE', 'Music catalog is not connected');
