import { apiErrorSchema } from '@vozzify/contracts';
import { z } from 'zod';

import { mobileApi } from '../src/lib/api/mobile-api';

jest.mock('../src/lib/api/mobile-env', () => ({
  getMobileEnv: () => ({ apiBaseUrl: 'http://10.0.2.2:3333/' }),
}));

const resultSchema = z.object({ id: z.string() });
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('mobile API transport', () => {
  afterEach(() => jest.restoreAllMocks());

  it('serializes requests to the versioned API and validates the response', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(response({ id: 'track_1' }));

    await expect(
      mobileApi('/tracks', {
        schema: resultSchema,
        method: 'POST',
        body: { title: 'Example' },
        bodySchema: z.object({ title: z.string() }),
        query: { limit: 10, cursor: null, visible: true },
        querySchema: z.object({
          limit: z.number(),
          cursor: z.null(),
          visible: z.boolean(),
        }),
      }),
    ).resolves.toEqual({ id: 'track_1' });

    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe(
      'http://10.0.2.2:3333/v1/tracks?limit=10&visible=true',
    );
    expect(init?.method).toBe('POST');
    expect(init?.headers).toBeInstanceOf(Headers);
    expect(new Headers(init?.headers).get('content-type')).toBe(
      'application/json',
    );
    expect(init?.body).toBe('{"title":"Example"}');
  });

  it('rejects a request that does not match its shared input schema', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(
      mobileApi('/tracks', {
        schema: resultSchema,
        body: { title: 42 },
        bodySchema: z.object({ title: z.string() }),
      }),
    ).rejects.toMatchObject({ kind: 'invalid-request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires shared schemas for request bodies and query parameters', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(
      mobileApi('/tracks', {
        schema: resultSchema,
        query: { limit: 10 },
      }),
    ).rejects.toMatchObject({ kind: 'invalid-request' });
    await expect(
      mobileApi('/tracks', {
        schema: resultSchema,
        body: { title: 'Example' },
      }),
    ).rejects.toMatchObject({ kind: 'invalid-request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces structured API error codes without translating their message', async () => {
    const apiError = apiErrorSchema.parse({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Sign in required',
      details: { source: 'session' },
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(response(apiError, 401));

    await expect(
      mobileApi('/private', { schema: resultSchema }),
    ).rejects.toEqual(
      expect.objectContaining({
        kind: 'http',
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Sign in required',
        details: { source: 'session' },
      }),
    );
  });

  it('reports an invalid successful response as a typed transport error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response({ id: 12 }));

    await expect(
      mobileApi('/tracks/track_1', { schema: resultSchema }),
    ).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });

  it('wraps network failures with the original cause', async () => {
    const networkError = new TypeError('offline');
    jest.spyOn(global, 'fetch').mockRejectedValue(networkError);

    await expect(
      mobileApi('/tracks', { schema: resultSchema }),
    ).rejects.toMatchObject({
      kind: 'network',
      cause: networkError,
    });
  });

  it('preserves cancellation errors so queries can stop cleanly', async () => {
    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abortError);
    const controller = new AbortController();

    await expect(
      mobileApi('/tracks', {
        schema: resultSchema,
        signal: controller.signal,
      }),
    ).rejects.toBe(abortError);
  });

  it('preserves cancellation while reading a successful response body', async () => {
    const abortError = new Error('body read cancelled');
    abortError.name = 'AbortError';
    const apiResponse = response({ id: 'track_1' });
    jest.spyOn(apiResponse, 'json').mockRejectedValue(abortError);
    jest.spyOn(global, 'fetch').mockResolvedValue(apiResponse);

    await expect(
      mobileApi('/tracks/track_1', { schema: resultSchema }),
    ).rejects.toBe(abortError);
  });
});
