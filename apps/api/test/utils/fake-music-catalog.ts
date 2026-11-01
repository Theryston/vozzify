import { type WebSocket, WebSocketServer } from 'ws';

export const FAKE_CATALOG_API_KEY =
  'e2e-fake-music-catalog-api-key-change-me00';

export type FakeCatalogHandler = (payload: Record<string, unknown>) => {
  delayMs?: number;
  result?: unknown;
  error?: unknown;
  closeConnection?: boolean;
  sendUnreadableFrame?: boolean;
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
  close: () => Promise<void>;
};

export const startFakeMusicCatalog = async (
  handler: FakeCatalogHandler,
): Promise<FakeMusicCatalog> => {
  const seenAuth: string[] = [];
  const seenQueries: string[] = [];
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));
  const address = server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;

  server.on('connection', (socket: WebSocket, request) => {
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
        if (answer.sendUnreadableFrame === true) {
          socket.send('not json');
          return;
        }
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
    // `server.close` waits for open peers, so specs close their app (and
    // its catalog socket) before calling this.
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};
