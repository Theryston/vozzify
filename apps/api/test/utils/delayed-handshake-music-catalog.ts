import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';

type Upgrade = { request: IncomingMessage; socket: Duplex; head: Buffer };
type HeldRequest = { id: string; socket: WebSocket };
type Waiter = { query: string; count: number; resolve: () => void };
type CatalogState = {
  seenQueries: string[];
  heldVisitors: HeldRequest[];
  heldProbes: HeldRequest[];
  queryWaiters: Waiter[];
};
type HandshakeGate = {
  wait: () => Promise<void>;
  accept: () => void;
};

export type DelayedHandshakeMusicCatalog = {
  url: string;
  seenQueries: string[];
  waitForHandshake: () => Promise<void>;
  acceptHandshake: () => void;
  setAutoPong: (enabled: boolean) => void;
  waitForQueryCount: (query: string, count: number) => Promise<void>;
  answerVisitorLate: () => void;
  answerProbe: (ready: boolean) => void;
  close: () => Promise<void>;
};

export async function startDelayedHandshakeMusicCatalog(options?: {
  autoPong?: boolean;
}): Promise<DelayedHandshakeMusicCatalog> {
  const httpServer = createServer();
  const socketServer = new WebSocketServer({
    noServer: true,
    autoPong: options?.autoPong ?? true,
  });
  const state = createState();
  const handshake = createHandshakeGate(httpServer, socketServer);
  socketServer.on('connection', (socket) => watchRequests(socket, state));
  const port = await listen(httpServer);

  return {
    url: `ws://127.0.0.1:${port}`,
    seenQueries: state.seenQueries,
    waitForHandshake: handshake.wait,
    acceptHandshake: handshake.accept,
    setAutoPong: (enabled) => {
      socketServer.options.autoPong = enabled;
    },
    waitForQueryCount: (query, count) => waitForQueryCount(state, query, count),
    answerVisitorLate: () => answerVisitorLate(state),
    answerProbe: (ready) => answerProbe(state, ready),
    close: async () => closeServer(httpServer, socketServer),
  };
}

function createState(): CatalogState {
  return {
    seenQueries: [],
    heldVisitors: [],
    heldProbes: [],
    queryWaiters: [],
  };
}

function createHandshakeGate(
  httpServer: Server,
  socketServer: WebSocketServer,
): HandshakeGate {
  let upgrade: Upgrade | undefined;
  let resolveHandshake: (() => void) | undefined;
  const requested = new Promise<void>((resolve) => {
    resolveHandshake = resolve;
  });
  httpServer.on('upgrade', (request, socket, head) => {
    upgrade = { request, socket, head };
    resolveHandshake?.();
  });
  return {
    wait: () => requested,
    accept: () => {
      if (upgrade === undefined) throw new Error('Handshake has not arrived');
      const current = upgrade;
      socketServer.handleUpgrade(
        current.request,
        current.socket,
        current.head,
        (socket) => socketServer.emit('connection', socket, current.request),
      );
    },
  };
}

function watchRequests(socket: WebSocket, state: CatalogState): void {
  socket.on('message', (data: RawData) => {
    const message = JSON.parse(String(data)) as {
      id: string;
      payload: { query?: unknown };
    };
    const query = String(message.payload.query ?? '');
    state.seenQueries.push(query);
    wakeQueryWaiters(state, query);
    const held = { id: message.id, socket };
    if (query === 'not-ready fallback song') state.heldVisitors.push(held);
    else if (query === 'vozzify primary health check') {
      state.heldProbes.push(held);
    } else answer(held);
  });
}

function wakeQueryWaiters(state: CatalogState, query: string): void {
  const count = state.seenQueries.filter((seen) => seen === query).length;
  for (const waiter of [...state.queryWaiters]) {
    if (waiter.query !== query || count < waiter.count) continue;
    state.queryWaiters.splice(state.queryWaiters.indexOf(waiter), 1);
    waiter.resolve();
  }
}

function waitForQueryCount(
  state: CatalogState,
  query: string,
  count: number,
): Promise<void> {
  if (state.seenQueries.filter((seen) => seen === query).length >= count) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) =>
    state.queryWaiters.push({ query, count, resolve }),
  );
}

function answerVisitorLate(state: CatalogState): void {
  const request = state.heldVisitors.shift();
  if (request === undefined) throw new Error('No visitor request is held');
  answer(request);
}

function answerProbe(state: CatalogState, ready: boolean): void {
  const request = state.heldProbes.shift();
  if (request === undefined) throw new Error('No health check is held');
  if (ready) {
    answer(request);
    return;
  }
  request.socket.send(
    JSON.stringify({
      id: request.id,
      ok: false,
      error: { code: 'CATALOG_NOT_READY', message: 'Not ready' },
    }),
  );
}

function answer(request: HeldRequest): void {
  request.socket.send(
    JSON.stringify({ id: request.id, ok: true, result: { results: [] } }),
  );
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
}

async function closeServer(
  httpServer: Server,
  socketServer: WebSocketServer,
): Promise<void> {
  for (const socket of socketServer.clients) socket.terminate();
  await new Promise<void>((resolve) => socketServer.close(() => resolve()));
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
}
