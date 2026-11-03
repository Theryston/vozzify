import { Injectable } from '@nestjs/common';

/** An image as downloaded: its bytes and the type the server declared. */
export type DownloadedImage = { bytes: Uint8Array; contentType: string };

const COVER_ART_ARCHIVE = 'https://coverartarchive.org';

// The archive and YouTube's CDN both answer quickly; a slow download is held
// back rather than waited for, and a huge one is not a cover.
const TIMEOUT_MS = 10_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Downloads cover images: the Cover Art Archive's front cover of a release,
 * and any image by URL (the chosen YouTube video thumbnail). The only code that fetches
 * them; features depend on this class, so tests replace it at this boundary.
 */
@Injectable()
export class CoverArtClient {
  /**
   * The front cover of a release, at 500 px. Undefined when the archive has no
   * cover for it (its 404), which is an answer, not a failure.
   */
  fetchReleaseFrontCover(
    releaseMbid: string,
  ): Promise<DownloadedImage | undefined> {
    return this.download(
      `${COVER_ART_ARCHIVE}/release/${releaseMbid}/front-500`,
    );
  }

  /** An image by its URL; undefined when it is missing or not an image. */
  fetchImage(url: string): Promise<DownloadedImage | undefined> {
    return this.download(url);
  }

  private async download(url: string): Promise<DownloadedImage | undefined> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Image download failed with HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    const declaredLength = Number(response.headers.get('content-length'));
    if (!contentType.startsWith('image/') || declaredLength > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      return undefined;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= MAX_IMAGE_BYTES
      ? { bytes, contentType }
      : undefined;
  }
}
