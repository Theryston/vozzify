import { randomUUID } from 'node:crypto';
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PRIVATE_AUDIO_MAX_BYTES } from '@vozzify/contracts';
import type { Request } from 'express';
import { finalize, type Observable } from 'rxjs';
import { invalidPrivateAudio } from './private-audio.js';

type UploadRequest = Request & {
  body: Record<string, unknown>;
  privateAudioDirectory?: string;
  file?: { path: string; originalname: string; mimetype: string };
};
type UploadFileStream = {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  stream: Readable;
};
type StoredUpload = {
  destination: string;
  filename: string;
  path: string;
  size: number;
};
type StorageCallback = (error: Error | null, info?: StoredUpload) => void;

const fileStorage = {
  _handleFile(
    request: UploadRequest,
    file: UploadFileStream,
    callback: StorageCallback,
  ) {
    const directory = request.privateAudioDirectory;
    if (!directory) {
      callback(new Error('Private audio upload directory is unavailable'));
      return;
    }
    const filename = randomUUID();
    const path = join(directory, filename);
    pipeline(file.stream, createWriteStream(path, { flags: 'wx' }))
      .then(async () => {
        const { size } = await stat(path);
        callback(null, { destination: directory, filename, path, size });
      })
      .catch((error: unknown) =>
        callback(error instanceof Error ? error : new Error(String(error))),
      );
  },
  _removeFile(
    _request: UploadRequest,
    file: StoredUpload,
    callback: (error?: Error | null) => void,
  ) {
    rm(file.path, { force: true })
      .then(() => callback(null))
      .catch((error: unknown) =>
        callback(error instanceof Error ? error : new Error(String(error))),
      );
  },
};

@Injectable()
export class PrivateAudioUploadInterceptor extends FileInterceptor('audio', {
  storage: fileStorage,
  limits: { files: 1, fields: 0, fileSize: PRIVATE_AUDIO_MAX_BYTES },
  defParamCharset: 'utf8',
}) {
  override async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<UploadRequest>();
    const directory = await mkdtemp(join(tmpdir(), 'vozzify-private-audio-'));
    request.privateAudioDirectory = directory;
    try {
      const handler = await super.intercept(context, next);
      const upload = request.file;
      if (upload) {
        const blob = await openAsBlob(upload.path, { type: upload.mimetype });
        request.body ??= {};
        request.body.audio = new File([blob], upload.originalname, {
          type: upload.mimetype,
        });
      }
      return handler.pipe(
        finalize(() => {
          void removePrivateAudioUpload(directory).catch(() => undefined);
        }),
      );
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error instanceof PayloadTooLargeException
        ? invalidPrivateAudio(
            `Audio is larger than ${PRIVATE_AUDIO_MAX_BYTES} bytes`,
          )
        : error;
    }
  }
}

const removePrivateAudioUpload = (directory: string) =>
  rm(directory, { recursive: true, force: true });
