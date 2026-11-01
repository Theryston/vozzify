import { Logger } from '@nestjs/common';
import WebSocket from 'ws';

const LIVENESS_INTERVAL_MS = 2_000;
const LIVENESS_TIMEOUT_MS = 2_000;

export class MusicCatalogLiveness {
  private readonly logger = new Logger('MusicCatalogClient');
  private readonly interval: NodeJS.Timeout;
  private deadline: NodeJS.Timeout | undefined;
  private awaitingPong = false;

  constructor(private readonly socket: WebSocket) {
    socket.on('pong', this.handlePong);
    this.interval = setInterval(this.check, LIVENESS_INTERVAL_MS);
    this.interval.unref();
  }

  stop(): void {
    clearInterval(this.interval);
    if (this.deadline !== undefined) clearTimeout(this.deadline);
    this.socket.off('pong', this.handlePong);
    this.awaitingPong = false;
  }

  private readonly handlePong = (): void => {
    this.awaitingPong = false;
    if (this.deadline !== undefined) clearTimeout(this.deadline);
    this.deadline = undefined;
  };

  private readonly check = (): void => {
    if (this.awaitingPong || this.socket.readyState !== WebSocket.OPEN) return;
    this.awaitingPong = true;
    this.deadline = setTimeout(() => {
      this.deadline = undefined;
      if (!this.awaitingPong) return;
      this.logger.warn('Music catalog liveness check timed out');
      this.socket.terminate();
    }, LIVENESS_TIMEOUT_MS);
    try {
      this.socket.ping();
    } catch {
      this.socket.terminate();
    }
  };
}
