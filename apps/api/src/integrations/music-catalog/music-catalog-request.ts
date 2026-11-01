import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app-exception.js';

export type PendingRequest = {
  answer: (frame: unknown) => boolean;
  markUnreadable: () => void;
  invalid: () => void;
  fail: (error: Error) => void;
};

type RequestOptions<TOutput> = {
  pending: Map<string, PendingRequest>;
  socket: WebSocket;
  type: string;
  payload: unknown;
  responseSchema: z.ZodType<TOutput>;
  timeoutMs: number;
};

export function requestOnSocket<TOutput>(
  options: RequestOptions<TOutput>,
): Promise<TOutput> {
  const { pending, socket, type, payload, responseSchema, timeoutMs } = options;
  const id = randomUUID();
  const strictProtocol = type === 'search';
  return new Promise<TOutput>((resolve, reject) => {
    let unreadable = false;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(timeoutError(unreadable && strictProtocol));
    }, timeoutMs);
    const settle = (): void => {
      pending.delete(id);
      clearTimeout(timer);
    };
    pending.set(id, {
      markUnreadable: () => {
        unreadable ||= strictProtocol;
      },
      invalid: () => {
        if (!strictProtocol) return;
        settle();
        reject(
          new AppException(
            'INTERNAL_ERROR',
            'Music catalog sent an invalid response',
          ),
        );
      },
      answer: (frame) => {
        const response = responseSchema.safeParse(frame);
        if (!response.success) return false;
        settle();
        resolve(response.data);
        return true;
      },
      fail: (error) => {
        settle();
        reject(unreadable && strictProtocol ? invalidResponse() : error);
      },
    });
    try {
      socket.send(JSON.stringify({ id, type, payload }));
    } catch {
      settle();
      reject(
        new AppException(
          'SERVICE_UNAVAILABLE',
          'Music catalog is not connected',
        ),
      );
    }
  });
}

const timeoutError = (unreadable: boolean): AppException =>
  unreadable ? invalidResponse() : requestTimeout();

const invalidResponse = (): AppException =>
  new AppException('INTERNAL_ERROR', 'Music catalog sent an invalid response');

const requestTimeout = (): AppException =>
  new AppException('GATEWAY_TIMEOUT', 'Music catalog request timed out');
