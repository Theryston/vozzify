import { createServer, type Socket } from 'node:net';
import type { Env } from '../../config/env.js';
import { parseEnv } from '../../config/env.js';
import { SonicService } from './sonic.service.js';
import { SonicChannel, SonicChannelError } from './sonic-channel.js';

describe('SonicChannel', () => {
  it('quotes search text and accepts pending event responses', async () => {
    const commands: string[] = [];
    await withChannel(
      (socket, line) => {
        if (line.startsWith('START ')) {
          socket.write('CONNECTED 1.0\nSTARTED search 1.0\n');
        } else {
          commands.push(line);
          socket.write('PENDING\nEVENT QUERY 1 first second\n');
        }
      },
      async (channel) => {
        await expect(
          channel.query('a "quote" \\ path\nnext', 20, 5),
        ).resolves.toEqual(['first', 'second']);
        expect(commands).toEqual([
          'QUERY tracks completed "a \\"quote\\" \\\\ path next" LIMIT(20) OFFSET(5)',
        ]);
      },
    );
  });

  it('sends push and flush commands and accepts acknowledgments', async () => {
    const commands: string[] = [];
    await withChannel(
      (socket, line) => {
        if (line.startsWith('START ')) {
          socket.write('STARTED ingest 1.0\n');
          return;
        }
        commands.push(line);
        socket.write(line.startsWith('PUSH ') ? 'OK\n' : 'RESULT 0\n');
      },
      async (channel) => {
        await channel.push('track-1', 'A Song');
        await channel.removeObject('vozzify_meta', 'completed', 'index-ready');
        expect(commands).toEqual([
          'PUSH tracks completed track-1 "A Song"',
          'FLUSHO vozzify_meta completed index-ready',
        ]);
      },
    );
  });

  it('classifies a rejected handshake as authentication failure', async () => {
    await withChannel(
      (socket, line) => {
        if (line.startsWith('START '))
          socket.write('ERR authentication failed\n');
      },
      async (channel) => {
        await expect(channel.query('song', 10, 0)).rejects.toMatchObject({
          failure: 'authentication',
        });
      },
    );
  });

  it('classifies protocol errors and unexpected messages', async () => {
    await withChannel(
      (socket, line) => {
        if (line.startsWith('START ')) socket.write('STARTED search 1.0\n');
        else socket.write('ERR query failed\n');
      },
      async (channel) => {
        await expect(channel.query('song', 10, 0)).rejects.toMatchObject({
          failure: 'protocol',
        });
      },
    );
    await withChannel(
      (socket, line) => {
        if (line.startsWith('START ')) socket.write('STARTED search 1.0\n');
        else socket.write('UNKNOWN\n');
      },
      async (channel) => {
        await expect(channel.query('song', 10, 0)).rejects.toMatchObject({
          failure: 'protocol',
        });
      },
    );
  });

  it('classifies a closed connection and a response timeout', async () => {
    await withChannel(
      (socket, line) => {
        if (line.startsWith('START ')) socket.write('STARTED search 1.0\n');
        else socket.end();
      },
      async (channel) => {
        await expect(channel.query('song', 10, 0)).rejects.toMatchObject({
          failure: 'transport',
        });
      },
    );
    await withChannel(
      (socket, line) => {
        if (line.startsWith('START ')) socket.write('STARTED search 1.0\n');
      },
      async (channel) => {
        await expect(channel.query('song', 10, 0)).rejects.toMatchObject({
          failure: 'timeout',
        });
      },
      20,
    );
  });

  it('reports missing credentials as configuration failure', async () => {
    const channel = new SonicChannel(testEnv({}, false));
    await expect(channel.query('song', 10, 0)).rejects.toBeInstanceOf(
      SonicChannelError,
    );
  });

  it('checks readiness before searching and keeps the result order', async () => {
    await withSonicServer(
      (_socket, line) => {
        if (line.startsWith('START ')) {
          _socket.write('STARTED search 1.0\n');
        } else if (line.includes('vozzify-index-ready')) {
          _socket.write('EVENT QUERY 1 index-ready\n');
        } else {
          _socket.write('PENDING\nEVENT QUERY 1 second first\n');
        }
      },
      async (env) => {
        const service = new SonicService(env);
        await expect(service.search('song', 20, 0)).resolves.toEqual([
          'second',
          'first',
        ]);
      },
    );
  });

  it('rejects an uninitialized index and maps Sonic authentication errors', async () => {
    await withSonicServer(
      (socket, line) => {
        if (line.startsWith('START ')) socket.write('STARTED search 1.0\n');
        else socket.write('EVENT QUERY 1\n');
      },
      async (env) => {
        await expect(
          new SonicService(env).search('song', 20, 0),
        ).rejects.toMatchObject({
          code: 'SERVICE_UNAVAILABLE',
        });
      },
    );
    await withSonicServer(
      (socket, line) => {
        if (line.startsWith('START ')) socket.write('ERR bad password\n');
      },
      async (env) => {
        await expect(
          new SonicService(env).search('song', 20, 0),
        ).rejects.toMatchObject({
          code: 'INTERNAL_ERROR',
        });
      },
    );
  });

  it('writes Tracks and toggles the readiness marker', async () => {
    const commands: string[] = [];
    await withSonicServer(
      (socket, line) => {
        if (line.startsWith('START ')) {
          socket.write('STARTED ingest 1.0\n');
          return;
        }
        commands.push(line);
        socket.write(line.startsWith('PUSH ') ? 'OK\n' : 'RESULT 1\n');
      },
      async (env) => {
        const service = new SonicService(env);
        await service.indexTrack('track-1', 'Song Artist');
        await service.markIndexReady();
        await service.markIndexNotReady();
        expect(commands).toEqual([
          'PUSH tracks completed track-1 "Song Artist"',
          'PUSH vozzify_meta completed index-ready "vozzify-index-ready"',
          'FLUSHO vozzify_meta completed index-ready',
        ]);
      },
    );
  });
});

const testEnv = (
  overrides: Record<string, string | undefined> = {},
  sonicConfigured = true,
): Env =>
  parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    ...(sonicConfigured
      ? {
          SONIC_HOST: '127.0.0.1',
          SONIC_AUTH_PASSWORD: 'secret',
          SONIC_REQUEST_TIMEOUT_MS: '500',
        }
      : {}),
    ...overrides,
  });

const withChannel = async (
  onLine: (socket: Socket, line: string) => void,
  run: (channel: SonicChannel) => Promise<void>,
  timeoutMs = 500,
): Promise<void> => {
  await withSonicServer(
    onLine,
    async (env) => run(new SonicChannel(env)),
    timeoutMs,
  );
};

const withSonicServer = async (
  onLine: (socket: Socket, line: string) => void,
  run: (env: Env) => Promise<void>,
  timeoutMs = 500,
): Promise<void> => {
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    let input = '';
    socket.on('data', (chunk: string) => {
      input += chunk;
      let newline = input.indexOf('\n');
      while (newline >= 0) {
        const line = input.slice(0, newline);
        input = input.slice(newline + 1);
        onLine(socket, line);
        newline = input.indexOf('\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Sonic test server has no TCP address');
  }
  const env = testEnv({
    SONIC_PORT: String(address.port),
    SONIC_REQUEST_TIMEOUT_MS: String(timeoutMs),
  });
  try {
    await run(env);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};
