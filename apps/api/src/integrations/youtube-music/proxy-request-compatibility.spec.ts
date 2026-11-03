import { Response as HttpResponse, MockAgent, ProxyAgent } from 'undici';
import { createProxiedFetch } from './http-proxy.js';

describe('YouTube proxy Request compatibility', () => {
  const upstream = 'https://youtube.test';
  let agent: MockAgent;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    vi.spyOn(ProxyAgent.prototype, 'dispatch').mockImplementation(
      (options, handler) => agent.dispatch(options, handler),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await agent.close();
  });

  const proxied = () =>
    createProxiedFetch({
      uri: 'http://proxy.test:8080',
      token: 'Basic fixture',
    });

  it('preserves the native Request URL, POST body and headers used by the SDK', async () => {
    const body = JSON.stringify({ videoId: 'aaaaaaaaaaa' });
    let receivedBody: string | undefined;
    agent
      .get(upstream)
      .intercept({
        path: '/youtubei/v1/player',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      .reply(async (options) => {
        receivedBody = await new HttpResponse(options.body).text();
        return {
          statusCode: 200,
          data: { playabilityStatus: { status: 'OK' } },
        };
      });
    const request = new Request(`${upstream}/youtubei/v1/player`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    const response = await proxied()(request);

    expect(await response.json()).toEqual({
      playabilityStatus: { status: 'OK' },
    });
    expect(receivedBody).toBe(body);
    agent.assertNoPendingInterceptors();
  });

  it('still accepts URL inputs with an explicit init', async () => {
    let receivedBody: string | undefined;
    agent
      .get(upstream)
      .intercept({ path: '/player', method: 'POST' })
      .reply(async (options) => {
        receivedBody = await new HttpResponse(options.body).text();
        return { statusCode: 200, data: 'ok' };
      });

    const response = await proxied()(new URL('/player', upstream), {
      method: 'POST',
      body: 'payload',
    });

    expect(await response.text()).toBe('ok');
    expect(receivedBody).toBe('payload');
    agent.assertNoPendingInterceptors();
  });

  it('preserves cancellation from a native Request', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = new Request(`${upstream}/player`, {
      signal: controller.signal,
    });

    await expect(proxied()(request)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
