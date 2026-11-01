import { Logger } from '@nestjs/common';
import WebSocket from 'ws';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';
import type { Env } from '../../config/env.js';
import {
  type PendingRequest,
  requestOnSocket,
} from './music-catalog-request.js';

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10_000;

const MUSIC_CATALOG_DEFAULT_TIMEOUT_MS = 5_000;

/** Multiplexed, reconnecting WebSocket transport for MusicCatalogClient. */
export class MusicCatalogConnection {
  private readonly logger = new Logger('MusicCatalogClient');
  private socket: WebSocket | undefined;
  private connecting: Promise<void> | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private searchGeneration = 0;
  private authenticationFailure: string | undefined;
  private readonly closeListeners = new Set<() => void>();

  constructor(private readonly env: Env) {}

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  getSearchGeneration(): number {
    return this.searchGeneration;
  }

  getAuthenticationFailure(): string | undefined {
    return this.authenticationFailure;
  }

  onSearchConnectionClosed(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  start(): void {
    this.ensureConnected().catch((error: unknown) => {
      this.logger.warn(
        `Music catalog initial dial failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.scheduleReconnect();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close();
    this.socket = undefined;
    this.failPending(
      new AppException('INTERNAL_ERROR', 'Music catalog is shutting down'),
    );
  }

  async request<TOutput>(
    type: string,
    payload: unknown,
    responseSchema: z.ZodType<TOutput>,
  ): Promise<TOutput> {
    const socket = await this.openSocket();
    return requestOnSocket({
      pending: this.pending,
      socket,
      type,
      payload,
      responseSchema,
      timeoutMs: this.requestTimeoutMs(),
    });
  }

  requestIfConnected<TOutput>(
    type: string,
    payload: unknown,
    responseSchema: z.ZodType<TOutput>,
  ): Promise<TOutput> {
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(notConnected());
    }
    return requestOnSocket({
      pending: this.pending,
      socket,
      type,
      payload,
      responseSchema,
      timeoutMs: this.requestTimeoutMs(),
    });
  }

  private async openSocket(): Promise<WebSocket> {
    try {
      await this.ensureConnected();
    } catch (error: unknown) {
      this.logger.warn(
        `Music catalog dial failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (this.authenticationFailure !== undefined) {
        throw new AppException(
          'INTERNAL_ERROR',
          'Music catalog authentication failed',
        );
      }
      throw notConnected();
    }
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
      throw notConnected();
    }
    return socket;
  }

  private requestTimeoutMs(): number {
    return (
      this.env.MUSIC_CATALOG_REQUEST_TIMEOUT_MS ??
      MUSIC_CATALOG_DEFAULT_TIMEOUT_MS
    );
  }

  private ensureConnected(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    this.connecting ??= this.dialOnce().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async dialOnce(): Promise<void> {
    const url = this.env.MUSIC_CATALOG_URL;
    const key = this.env.MUSIC_CATALOG_API_KEY;
    if (url === undefined || key === undefined) {
      throw new AppException(
        'INTERNAL_ERROR',
        'Music catalog is not configured',
      );
    }
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${key}` },
    });
    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        socket.off('error', onError);
        socket.off('close', onClose);
        resolve();
      };
      const onError = (error: Error): void => {
        if (
          /Unexpected server response: 401|Unexpected server response: 403/.test(
            error.message,
          )
        ) {
          this.authenticationFailure = error.message;
        }
        socket.off('open', onOpen);
        socket.off('close', onClose);
        reject(error);
      };
      const onClose = (): void => {
        socket.off('open', onOpen);
        socket.off('error', onError);
        reject(new Error('Connection closed'));
      };
      socket.once('open', onOpen);
      socket.once('error', onError);
      socket.once('close', onClose);
    });
    if (this.stopped) {
      socket.close();
      throw new AppException(
        'INTERNAL_ERROR',
        'Music catalog is shutting down',
      );
    }
    this.attachSocket(socket);
    this.socket = socket;
    this.authenticationFailure = undefined;
    this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    this.logger.log('Connected to the Music catalog');
  }

  private attachSocket(socket: WebSocket): void {
    socket.on('message', (data, isBinary) => {
      if (isBinary === true) {
        this.logger.warn('Dropping a binary frame from the Music catalog');
        this.failPending(
          new AppException(
            'INTERNAL_ERROR',
            'Music catalog sent a binary response',
          ),
        );
        return;
      }
      this.handleMessage(String(data));
    });
    socket.on('close', () => this.handleClose(socket));
    socket.on('error', (error: Error) => {
      this.logger.warn(`Music catalog socket error: ${error.message}`);
    });
  }

  private handleMessage(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.warn('Dropping a non-JSON frame from the Music catalog');
      this.markPendingUnreadable();
      return;
    }
    const id = requestIdOf(parsed);
    if (id === undefined) {
      this.logger.warn('Dropping an unreadable frame from the Music catalog');
      this.markPendingUnreadable();
      return;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      return;
    }
    if (!pending.answer(parsed)) {
      this.logger.warn('Dropping an unreadable frame from the Music catalog');
      pending.invalid();
    }
  }

  private markPendingUnreadable(): void {
    for (const request of this.pending.values()) request.markUnreadable();
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) {
      return;
    }
    this.socket = undefined;
    this.searchGeneration += 1;
    for (const listener of this.closeListeners) listener();
    this.failPending(
      new AppException('SERVICE_UNAVAILABLE', 'Music catalog disconnected'),
    );
    if (this.stopped) {
      return;
    }
    this.logger.warn('Lost the Music catalog connection, redialing');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) {
      return;
    }
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.stopped) {
        return;
      }
      this.ensureConnected().catch((error: unknown) => {
        this.logger.warn(
          `Music catalog redial failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        this.scheduleReconnect();
      });
    }, delay);
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.fail(error);
    }
  }
}

const notConnected = (): AppException =>
  new AppException('SERVICE_UNAVAILABLE', 'Music catalog is not connected');

function requestIdOf(frame: unknown): string | undefined {
  if (typeof frame !== 'object' || frame === null || !('id' in frame)) {
    return undefined;
  }
  return typeof frame.id === 'string' ? frame.id : undefined;
}
