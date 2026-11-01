import WebSocket, { WebSocketServer } from 'ws';
import { MusicCatalogLiveness } from './music-catalog-liveness.js';

describe('MusicCatalogLiveness', () => {
  it('closes a connection that does not answer the bounded ping deadline', async () => {
    const server = new WebSocketServer({ port: 0, autoPong: false });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => socket.once('open', resolve));
    const terminate = vi.spyOn(socket, 'terminate');
    vi.useFakeTimers();
    const liveness = new MusicCatalogLiveness(socket);

    try {
      await vi.advanceTimersByTimeAsync(4_000);
      expect(terminate).toHaveBeenCalledOnce();
    } finally {
      liveness.stop();
      vi.useRealTimers();
      socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
