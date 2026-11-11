import { apiErrorSchema } from '@vozzify/contracts';
import type { z } from 'zod';
import { MobileApiError, MobileHttpError } from './mobile-api-error';
import { getMobileEnv } from './mobile-env';

type QueryValue = string | number | boolean | null | undefined;

export type MobileApiOptions<TSchema extends z.ZodType> = {
  schema: TSchema;
  bodySchema?: z.ZodType;
  querySchema?: z.ZodType<Record<string, QueryValue>>;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

function isFormData(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function createUrl(
  baseUrl: string,
  path: `/${string}`,
  query: Record<string, QueryValue> | undefined,
): URL {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/v1${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function parseFailure(response: Response): Promise<MobileHttpError> {
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
  }
  const parsed = apiErrorSchema.safeParse(responseBody);
  if (parsed.success) {
    return new MobileHttpError(
      parsed.data.statusCode,
      parsed.data.code,
      parsed.data.message,
      parsed.data.details,
    );
  }
  return new MobileHttpError(
    response.status,
    'INTERNAL_ERROR',
    `Unexpected ${response.status} response from the API`,
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function parseSuccess(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  try {
    return await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    return undefined;
  }
}

function prepareRequest<TSchema extends z.ZodType>(
  path: `/${string}`,
  options: MobileApiOptions<TSchema>,
): { url: URL; init: RequestInit } {
  let url: URL;
  let body: unknown;
  let serializedBody: BodyInit | undefined;
  let bodyIsFormData = false;
  let headers: Headers;
  try {
    if (options.body !== undefined && options.bodySchema === undefined) {
      throw new Error('A shared body schema is required when sending a body');
    }
    if (options.query !== undefined && options.querySchema === undefined) {
      throw new Error('A shared query schema is required when sending a query');
    }
    url = createUrl(
      getMobileEnv().apiBaseUrl,
      path,
      options.querySchema?.parse(options.query) ?? options.query,
    );
    body =
      options.bodySchema === undefined
        ? options.body
        : options.bodySchema.parse(options.body);
    if (isFormData(body)) {
      serializedBody = body;
      bodyIsFormData = true;
    } else if (body !== undefined) {
      const json = JSON.stringify(body);
      if (json === undefined) {
        throw new Error('Request body cannot be serialized as JSON');
      }
      serializedBody = json;
    }
    headers = new Headers(options.headers);
    headers.set('accept', 'application/json');
    if (body !== undefined && !bodyIsFormData) {
      headers.set('content-type', 'application/json');
    }
  } catch (error) {
    throw new MobileApiError(
      'invalid-request',
      'Request does not match its contract or configuration',
      error,
    );
  }

  return {
    url,
    init: {
      method: options.method ?? 'GET',
      headers,
      ...(serializedBody === undefined ? {} : { body: serializedBody }),
      signal: options.signal,
    },
  };
}

export async function mobileApi<TSchema extends z.ZodType>(
  path: `/${string}`,
  options: MobileApiOptions<TSchema>,
): Promise<z.output<TSchema>> {
  const { url, init } = prepareRequest(path, options);
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new MobileApiError(
      'network',
      `Network error calling ${url.pathname}`,
      error,
    );
  }

  if (!response.ok) throw await parseFailure(response);
  const responseBody = await parseSuccess(response);
  const parsed = options.schema.safeParse(responseBody);
  if (!parsed.success) {
    throw new MobileApiError(
      'invalid-response',
      `Response from ${url.pathname} does not match its contract`,
      parsed.error,
    );
  }
  return parsed.data;
}
