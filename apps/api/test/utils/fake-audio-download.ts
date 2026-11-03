import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const TONE_MP3 = new Uint8Array(
  readFileSync(new URL('../fixtures/tone.mp3', import.meta.url)),
);

/** YouTube's audio transport, replaced at the integration boundary. */
export class FakeAudioDownload {
  readonly requests: string[] = [];
  readonly downloads: string[] = [];
  mp3: Uint8Array = TONE_MP3;
  requestFailure: Error | undefined;

  reset(): void {
    this.requests.length = 0;
    this.downloads.length = 0;
    this.mp3 = TONE_MP3;
    this.requestFailure = undefined;
  }

  async downloadToFile(videoId: string, path: string): Promise<void> {
    this.requests.push(videoId);
    if (this.requestFailure !== undefined) throw this.requestFailure;
    this.downloads.push(path);
    await writeFile(path, this.mp3);
  }
}
