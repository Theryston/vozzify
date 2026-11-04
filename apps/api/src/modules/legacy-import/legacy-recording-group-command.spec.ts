import { Logger } from '@nestjs/common';
import { LegacyRecordingGroupModule } from './legacy-recording-group.module.js';
import { LegacyRecordingGroupService } from './legacy-recording-group.service.js';
import { runLegacyRecordingGroup } from './legacy-recording-group-command.js';

const mocks = vi.hoisted(() => {
  const service = {
    prepare: vi.fn(),
    start: vi.fn(),
    retry: vi.fn(),
  };
  const app = { get: vi.fn(() => service), close: vi.fn() };
  return {
    service,
    app,
    createContext: vi.fn(async () => app),
    loadEnv: vi.fn(() => ({ NODE_ENV: 'test' })),
    logger: {},
  };
});

vi.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: mocks.createContext },
}));
vi.mock('../../config/env.js', () => ({ loadEnv: mocks.loadEnv }));
vi.mock('../../setup-app.js', () => ({
  createAppLogger: () => mocks.logger,
}));
vi.mock('./legacy-recording-group.module.js', () => ({
  LegacyRecordingGroupModule: class {},
}));
vi.mock('./legacy-recording-group.service.js', () => ({
  LegacyRecordingGroupService: class {},
}));

const MBID = '00000000-0000-4000-8000-000000000001';

describe('runLegacyRecordingGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mocks.createContext.mockResolvedValue(mocks.app);
    mocks.app.close.mockResolvedValue(undefined);
    mocks.service.prepare.mockResolvedValue({
      trackId: 'track',
      initialProcessingId: 'initial-processing',
    });
    mocks.service.start.mockResolvedValue(undefined);
    mocks.service.retry.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    [],
    ['--prepare-legacy-recording'],
    ['--prepare-legacy-recording', 'invalid'],
    ['--unknown', MBID],
    ['toString', MBID],
    ['--prepare-legacy-recording', MBID, '--start-legacy-recording', MBID],
    ['--prepare-legacy-recording', MBID, 'user-id'],
  ])('rejects invalid arguments before bootstrapping: %j', async (...args) => {
    expect(await runLegacyRecordingGroup(args)).toBe(false);
    expect(mocks.loadEnv).not.toHaveBeenCalled();
    expect(mocks.createContext).not.toHaveBeenCalled();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it.each([
    ['--prepare-legacy-recording', 'prepare'],
    ['--start-legacy-recording', 'start'],
    ['--retry-legacy-recording', 'retry'],
  ] as const)('dispatches %s and closes the context', async (flag, action) => {
    expect(await runLegacyRecordingGroup([flag, MBID])).toBe(true);
    expect(mocks.createContext).toHaveBeenCalledWith(
      LegacyRecordingGroupModule,
      { abortOnError: false, logger: mocks.logger },
    );
    expect(mocks.app.get).toHaveBeenCalledWith(LegacyRecordingGroupService);
    expect(mocks.service[action]).toHaveBeenCalledExactlyOnceWith(MBID);
    expect(mocks.app.close).toHaveBeenCalledOnce();
    expect(Logger.prototype.log).toHaveBeenCalled();
  });

  it('closes the context after a service failure without exposing the error', async () => {
    mocks.service.start.mockRejectedValueOnce(new Error('secret'));
    expect(
      await runLegacyRecordingGroup(['--start-legacy-recording', MBID]),
    ).toBe(false);
    expect(mocks.app.close).toHaveBeenCalledOnce();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.not.stringContaining('secret'),
    );
  });

  it('reports invalid configuration without starting a context', async () => {
    mocks.loadEnv.mockImplementationOnce(() => {
      throw new Error('invalid environment');
    });
    expect(
      await runLegacyRecordingGroup(['--prepare-legacy-recording', MBID]),
    ).toBe(false);
    expect(mocks.createContext).not.toHaveBeenCalled();
  });

  it('reports bootstrap failure', async () => {
    mocks.createContext.mockRejectedValueOnce(new Error('connection failed'));
    expect(
      await runLegacyRecordingGroup(['--prepare-legacy-recording', MBID]),
    ).toBe(false);
    expect(mocks.app.close).not.toHaveBeenCalled();
  });
});
