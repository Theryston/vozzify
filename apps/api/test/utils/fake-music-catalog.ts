import { type WebSocket, WebSocketServer } from 'ws';

export const FAKE_CATALOG_API_KEY =
  'e2e-fake-music-catalog-api-key-change-me00';

export type FakeCatalogHandler = (payload: Record<string, unknown>) => {
  delayMs?: number;
  result?: unknown;
  error?: unknown;
  closeConnection?: boolean;
  sendUnreadableFrame?: boolean;
  closeAfterUnreadableFrame?: boolean;
};

/**
 * Minimal Music catalog stand-in for API e2e specs: verifies the Bearer key
 * on the handshake and answers every `search` through `handler`. Responses
 * for concurrent requests may be delayed independently, so specs can prove
 * the API multiplexes by id with out-of-order answers.
 */
export type FakeMusicCatalog = {
  url: string;
  seenAuth: string[];
  seenQueries?: string[];
  disablePong: () => void;
  close: () => Promise<void>;
};

type FakeMusicCatalogOptions = {
  autoPong?: boolean;
};

export const startFakeMusicCatalog = async (
  handler: FakeCatalogHandler,
  options: FakeMusicCatalogOptions = {},
): Promise<FakeMusicCatalog> => {
  const seenAuth: string[] = [];
  const seenQueries: string[] = [];
  const sockets = new Set<WebSocket>();
  const server = new WebSocketServer({
    port: 0,
    autoPong: options.autoPong ?? true,
  });
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));
  const address = server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;

  server.on('connection', (socket: WebSocket, request) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    seenAuth.push(String(request.headers.authorization ?? ''));
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as {
        id: string;
        type: string;
        payload: Record<string, unknown>;
      };
      seenQueries.push(String(message.payload.query ?? ''));
      const answer = handler(message.payload);
      if (answer.closeConnection) {
        socket.close(1000, 'planned disconnect');
        return;
      }
      const respond = () => {
        if (socket.readyState !== socket.OPEN) {
          return;
        }
        if (sendUnreadableFrame(answer, socket)) return;
        if (answer.error !== undefined) {
          socket.send(
            JSON.stringify({ id: message.id, ok: false, error: answer.error }),
          );
          return;
        }
        socket.send(
          JSON.stringify({ id: message.id, ok: true, result: answer.result }),
        );
      };
      if (answer.delayMs !== undefined) {
        setTimeout(respond, answer.delayMs);
        return;
      }
      respond();
    });
  });

  return {
    url: `ws://127.0.0.1:${port}`,
    seenAuth,
    seenQueries,
    disablePong: () => {
      server.options.autoPong = false;
      for (const socket of sockets) socket.pong = () => undefined;
    },
    // `server.close` waits for open peers, so specs close their app (and
    // its catalog socket) before calling this.
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

const sendUnreadableFrame = (
  answer: ReturnType<FakeCatalogHandler>,
  socket: WebSocket,
): boolean => {
  if (answer.sendUnreadableFrame !== true) return false;
  socket.send('not json');
  if (answer.closeAfterUnreadableFrame === true) socket.close();
  return true;
};
