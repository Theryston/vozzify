import type { ApiErrorCode } from '@vozzify/contracts';

export class MobileApiError extends Error {
  readonly kind: 'network' | 'invalid-request' | 'invalid-response';

  constructor(
    kind: 'network' | 'invalid-request' | 'invalid-response',
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'MobileApiError';
    this.kind = kind;
  }
}

export class MobileHttpError extends Error {
  readonly kind = 'http';
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'MobileHttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
