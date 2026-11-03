import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { Injectable } from '@nestjs/common';
import { YouTubeMusicClient } from '../youtube-music/youtube-music.client.js';

const DOWNLOAD_TIMEOUT_MS = 2 * 60_000;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

/** Streams the chosen video's audio to a caller-owned temporary file. */
@Injectable()
export class AudioDownloadClient {
  constructor(private readonly youtube: YouTubeMusicClient) {}

  /** The caller removes the temporary directory, including partial files. */
  async downloadToFile(videoId: string, path: string): Promise<void> {
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const audio = await this.youtube.downloadAudio(videoId, signal);
    await pipeline(
      // Node and DOM declare this same Web Streams API with different BYOB types.
      Readable.fromWeb(audio as unknown as NodeReadableStream<Uint8Array>),
      limitAudioBytes,
      createWriteStream(path, { flags: 'wx', mode: 0o600 }),
      { signal },
    );
  }
}

async function* limitAudioBytes(chunks: AsyncIterable<Uint8Array>) {
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.byteLength;
    if (size > MAX_AUDIO_BYTES) {
      throw new Error('The audio is larger than the accepted size');
    }
    yield chunk;
  }
  if (size === 0) throw new Error('The audio stream was empty');
}
