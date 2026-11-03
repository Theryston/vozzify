import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { AudioDownloadClient } from '../../integrations/audio-download/audio-download.client.js';
import { FfmpegClient } from '../../integrations/ffmpeg/ffmpeg.client.js';
import {
  type PublicFile,
  StorageService,
} from '../../integrations/storage/storage.service.js';
import { TrackAudioService } from './track-audio.service.js';
import {
  type ProcessingForStep,
  TrackProcessingRepository,
} from './track-processing.repository.js';
import { TrackProcessingFailure } from './track-processing-failure.js';

const downloads = { downloadToFile: vi.fn() };
const ffmpeg = { convertAudioFileToWav: vi.fn() };
const storage = {
  putPublicFile: vi.fn(),
  publicUrl: vi.fn(),
  objectExists: vi.fn(),
};
const processings = { findMusicWavUrl: vi.fn(), saveMusicWavUrl: vi.fn() };
const wav = new Uint8Array([82, 73, 70, 70]);
const key = 'track-audio/track-1/processing-1.wav';
const storedUrl = `https://files.test/${key}`;
const processing = (
  overrides: Partial<ProcessingForStep> = {},
): ProcessingForStep => ({
  id: 'processing-1',
  trackId: 'track-1',
  status: 'DOWNLOADING_AUDIO',
  videoId: 'aaaaaaaaaaa',
  videoSource: 'musicbrainz',
  ...overrides,
});

describe('TrackAudioService direct downloads', () => {
  let service: TrackAudioService;
  let moduleRef: TestingModule;
  let paths: string[];

  beforeEach(async () => {
    vi.resetAllMocks();
    paths = [];
    processings.findMusicWavUrl.mockResolvedValue(null);
    processings.saveMusicWavUrl.mockResolvedValue(true);
    storage.objectExists.mockResolvedValue(false);
    storage.publicUrl.mockReturnValue(storedUrl);
    downloads.downloadToFile.mockImplementation(
      async (_id: string, path: string) => {
        paths.push(path);
        await writeFile(path, new Uint8Array([1, 2]));
      },
    );
    ffmpeg.convertAudioFileToWav.mockImplementation(
      async (_input: string, output: string) => {
        await writeFile(output, wav);
      },
    );
    storage.putPublicFile.mockImplementation(async (file: PublicFile) => {
      expect(await readFile(file.filePath)).toEqual(Buffer.from(wav));
    });
    moduleRef = await Test.createTestingModule({
      providers: [
        TrackAudioService,
        { provide: AudioDownloadClient, useValue: downloads },
        { provide: FfmpegClient, useValue: ffmpeg },
        { provide: StorageService, useValue: storage },
        { provide: TrackProcessingRepository, useValue: processings },
      ],
    }).compile();
    service = moduleRef.get(TrackAudioService);
  });

  afterEach(async () => {
    await moduleRef.close();
    for (const path of paths) expect(existsSync(dirname(path))).toBe(false);
  });

  it('downloads the chosen ID, converts files, streams to S3 and only then saves its URL', async () => {
    await expect(service.run(processing(), undefined)).resolves.toEqual({
      kind: 'done',
    });

    expect(downloads.downloadToFile).toHaveBeenCalledWith(
      'aaaaaaaaaaa',
      expect.any(String),
    );
    const source = paths[0];
    expect(source).toBeDefined();
    expect(ffmpeg.convertAudioFileToWav).toHaveBeenCalledWith(
      source,
      expect.stringMatching(/music\.wav$/),
    );
    expect(storage.putPublicFile).toHaveBeenCalledWith({
      key,
      filePath: expect.any(String),
      contentType: 'audio/wav',
    });
    expect(processings.saveMusicWavUrl).toHaveBeenCalledWith(
      'processing-1',
      storedUrl,
    );
    expect(storage.putPublicFile.mock.invocationCallOrder[0]).toBeLessThan(
      processings.saveMusicWavUrl.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('restarts an old queued conversion wait with the direct downloader', async () => {
    await expect(
      service.run(processing(), {
        round: 180,
        state: { progressUrl: 'https://old.test/progress' },
      }),
    ).resolves.toEqual({ kind: 'done' });
    expect(downloads.downloadToFile).toHaveBeenCalledOnce();
  });

  it.each(['download', 'conversion'])(
    'cleans partial files after a %s failure and preserves DOWNLOAD_FAILED',
    async (stage) => {
      const fail = async (_input: string, path: string) => {
        paths.push(path);
        await writeFile(path, new Uint8Array([1]));
        throw new Error('upstream failed');
      };
      if (stage === 'download')
        downloads.downloadToFile.mockImplementation(fail);
      else ffmpeg.convertAudioFileToWav.mockImplementation(fail);

      await expect(service.run(processing(), undefined)).rejects.toMatchObject({
        code: 'DOWNLOAD_FAILED',
      });
      expect(storage.putPublicFile).not.toHaveBeenCalled();
      expect(processings.saveMusicWavUrl).not.toHaveBeenCalled();
    },
  );

  it('cleans files and leaves the URL unset after an S3 failure, without misclassifying it', async () => {
    const failure = new Error('S3 is down');
    storage.putPublicFile.mockRejectedValue(failure);

    await expect(service.run(processing(), undefined)).rejects.toBe(failure);
    expect(processings.saveMusicWavUrl).not.toHaveBeenCalled();
  });

  it('cleans files when saving the uploaded URL fails', async () => {
    processings.saveMusicWavUrl.mockRejectedValue(new Error('database down'));

    await expect(service.run(processing(), undefined)).rejects.toThrow(
      'database down',
    );
    expect(storage.putPublicFile).toHaveBeenCalledOnce();
  });

  it('stops after uploading if the Processing has moved on', async () => {
    processings.saveMusicWavUrl.mockResolvedValue(false);
    await expect(service.run(processing(), undefined)).resolves.toEqual({
      kind: 'stopped',
    });
  });

  it('does not download or upload again when its stored URL exists', async () => {
    processings.findMusicWavUrl.mockResolvedValue(storedUrl);
    await expect(service.run(processing(), undefined)).resolves.toEqual({
      kind: 'done',
    });
    expect(downloads.downloadToFile).not.toHaveBeenCalled();
    expect(storage.objectExists).not.toHaveBeenCalled();
    expect(storage.putPublicFile).not.toHaveBeenCalled();
  });

  it('recovers an object uploaded before a crash without downloading again', async () => {
    storage.objectExists.mockResolvedValue(true);
    await expect(service.run(processing(), undefined)).resolves.toEqual({
      kind: 'done',
    });
    expect(downloads.downloadToFile).not.toHaveBeenCalled();
    expect(processings.saveMusicWavUrl).toHaveBeenCalledWith(
      'processing-1',
      storedUrl,
    );
  });

  it('keeps a storage lookup failure internal', async () => {
    const failure = new Error('S3 cannot check the key');
    storage.objectExists.mockRejectedValue(failure);
    await expect(service.run(processing(), undefined)).rejects.toBe(failure);
    expect(downloads.downloadToFile).not.toHaveBeenCalled();
  });

  it('rejects a missing video as an internal invariant failure', async () => {
    const failure = service.run(processing({ videoId: null }), undefined);
    await expect(failure).rejects.toThrow('has no video to download');
    await expect(failure).rejects.not.toBeInstanceOf(TrackProcessingFailure);
  });

  it('isolates concurrent jobs in separate directories', async () => {
    await Promise.all([
      service.run(processing(), undefined),
      service.run(processing({ id: 'processing-2' }), undefined),
    ]);
    expect(new Set(paths.map(dirname)).size).toBe(2);
  });
});
