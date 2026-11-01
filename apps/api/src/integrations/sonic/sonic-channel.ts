import { connect, type Socket } from 'node:net';
import type { Env } from '../../config/env.js';

type ChannelMode = 'search' | 'ingest';
export type SonicChannelFailure =
  | 'configuration'
  | 'authentication'
  | 'protocol'
  | 'timeout'
  | 'transport';

export class SonicChannelError extends Error {
  constructor(
    readonly failure: SonicChannelFailure,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_SONIC_PORT = 1491;
const DEFAULT_SONIC_TIMEOUT_MS = 5_000;
type CommandResult<TResult> =
  | { ok: true; value: TResult }
  | { ok: false; error: Error };
type SonicRequestOptions<TResult> = {
  host: string;
  port: number;
  password: string;
  mode: ChannelMode;
  send: (socket: Socket) => void;
  response: (line: string) => TResult | null;
  timeoutMs: number;
};

/** A bounded Sonic Channel session for one search or ingestion command. */
export class SonicChannel {
  constructor(private readonly env: Env) {}

  query(terms: string, limit: number, offset: number): Promise<string[]> {
    return this.searchCollection('tracks', terms, limit, offset);
  }

  searchCollection(
    collection: string,
    terms: string,
    limit: number,
    offset: number,
  ): Promise<string[]> {
    return this.command(
      'search',
      (socket) =>
        socket.write(
          `QUERY ${collection} completed "${quote(terms)}" LIMIT(${limit}) OFFSET(${offset})\n`,
        ),
      (line) => {
        if (!line.startsWith('EVENT QUERY ')) return null;
        const [, , , ...identifiers] = line.split(' ');
        return identifiers;
      },
    );
  }

  push(id: string, text: string): Promise<void> {
    return this.pushToCollection('tracks', id, text);
  }

  pushToCollection(
    collection: string,
    id: string,
    text: string,
  ): Promise<void> {
    return this.command<boolean>(
      'ingest',
      (socket) =>
        socket.write(`PUSH ${collection} completed ${id} "${quote(text)}"\n`),
      (line) => (line === 'OK' ? true : null),
    ).then(() => undefined);
  }

  removeObject(
    collection: string,
    bucket: string,
    object: string,
  ): Promise<void> {
    return this.command<boolean>(
      'ingest',
      (socket) => socket.write(`FLUSHO ${collection} ${bucket} ${object}\n`),
      (line) => (/^RESULT \d+$/.test(line) ? true : null),
    ).then(() => undefined);
  }

  private command<TResult>(
    mode: ChannelMode,
    send: (socket: Socket) => void,
    response: (line: string) => TResult | null,
  ): Promise<TResult> {
    const host = this.env.SONIC_HOST;
    const password = this.env.SONIC_AUTH_PASSWORD;
    if (host === undefined || password === undefined) {
      return Promise.reject(
        new SonicChannelError('configuration', 'Sonic is not configured'),
      );
    }
    const request = new SonicRequest({
      host,
      port: this.env.SONIC_PORT ?? DEFAULT_SONIC_PORT,
      password,
      mode,
      send,
      response,
      timeoutMs: this.env.SONIC_REQUEST_TIMEOUT_MS ?? DEFAULT_SONIC_TIMEOUT_MS,
    });
    return request.run();
  }
}

class SonicRequest<TResult> {
  private input = '';
  private started = false;
  private settled = false;
  private socket: Socket | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: SonicRequestOptions<TResult>) {}

  run(): Promise<TResult> {
    return new Promise((resolve, reject) => {
      this.socket = connect({
        host: this.options.host,
        port: this.options.port,
      });
      this.timer = setTimeout(
        () =>
          this.finish(
            {
              ok: false,
              error: new SonicChannelError(
                'timeout',
                'Sonic request timed out',
              ),
            },
            reject,
          ),
        this.options.timeoutMs,
      );
      this.socket.setEncoding('utf8');
      this.socket.on('connect', () => this.writeStart());
      this.socket.on('data', (chunk: string) =>
        this.read(chunk, resolve, reject),
      );
      this.socket.on('error', (error) =>
        this.finish(
          {
            ok: false,
            error: new SonicChannelError('transport', error.message),
          },
          reject,
        ),
      );
      this.socket.on('close', () => {
        if (!this.settled) {
          this.fail(
            'transport',
            'Sonic connection closed before a response',
            reject,
          );
        }
      });
    });
  }

  private writeStart(): void {
    this.socket?.write(`START ${this.options.mode} ${this.options.password}\n`);
  }

  private read(
    chunk: string,
    resolve: (value: TResult) => void,
    reject: (error: Error) => void,
  ): void {
    this.input += chunk;
    let newline = this.input.indexOf('\n');
    while (newline >= 0 && !this.settled) {
      const line = this.input.slice(0, newline).replace(/\r$/, '');
      this.input = this.input.slice(newline + 1);
      if (!this.readLine(line, resolve, reject)) return;
      newline = this.input.indexOf('\n');
    }
  }

  private readLine(
    line: string,
    resolve: (value: TResult) => void,
    reject: (error: Error) => void,
  ): boolean {
    if (!this.started) return this.readStartedLine(line, reject);
    if (line.startsWith('ERR ')) {
      this.fail('protocol', `Sonic rejected command: ${line}`, reject);
      return false;
    }
    const value = this.options.response(line);
    if (value !== null) {
      this.finish({ ok: true, value }, reject, resolve);
      return false;
    }
    if (line === 'PENDING' || line.startsWith('PENDING ')) return true;
    this.fail('protocol', `Unexpected Sonic response: ${line}`, reject);
    return false;
  }

  private readStartedLine(
    line: string,
    reject: (error: Error) => void,
  ): boolean {
    if (line.startsWith('CONNECTED ')) return true;
    if (!line.startsWith(`STARTED ${this.options.mode} `)) {
      this.fail(
        'authentication',
        'Sonic rejected channel authentication or mode',
        reject,
      );
      return false;
    }
    this.started = true;
    if (this.socket !== undefined) this.options.send(this.socket);
    return true;
  }

  private fail(
    failure: SonicChannelFailure,
    message: string,
    reject: (error: Error) => void,
  ): void {
    this.finish(
      { ok: false, error: new SonicChannelError(failure, message) },
      reject,
    );
  }

  private finish(
    result: CommandResult<TResult>,
    reject: (error: Error) => void,
    resolve?: (value: TResult) => void,
  ): void {
    if (this.settled) return;
    this.settled = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.socket?.destroy();
    if (result.ok) resolve?.(result.value);
    else reject(result.error);
  }
}

const quote = (value: string): string =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replace(/[\r\n]/g, ' ');
