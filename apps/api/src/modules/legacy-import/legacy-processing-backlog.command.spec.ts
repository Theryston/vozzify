import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { runLegacyProcessingBacklog } from './legacy-processing-backlog.command.js';
import { LegacyProcessingBacklogModule } from './legacy-processing-backlog.module.js';
import { LegacyProcessingBacklogService } from './legacy-processing-backlog.service.js';

const mocks = vi.hoisted(() => {
  const service = { drain: vi.fn() };
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
vi.mock('./legacy-processing-backlog.module.js', () => ({
  LegacyProcessingBacklogModule: class {},
}));
vi.mock('./legacy-processing-backlog.service.js', () => ({
  LegacyProcessingBacklogService: class {},
}));

describe('runLegacyProcessingBacklog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mocks.loadEnv.mockReturnValue({ NODE_ENV: 'test' });
    mocks.createContext.mockResolvedValue(mocks.app);
    mocks.app.close.mockResolvedValue(undefined);
    mocks.service.drain.mockResolvedValue({
      queued: 0,
      admitted: 0,
      running: 0,
      completed: 1,
      failed: 0,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('drains the module and closes its context', async () => {
    expect(await runLegacyProcessingBacklog()).toBe(true);
    expect(NestFactory.createApplicationContext).toHaveBeenCalledWith(
      LegacyProcessingBacklogModule,
      { abortOnError: false, logger: mocks.logger },
    );
    expect(mocks.app.get).toHaveBeenCalledWith(LegacyProcessingBacklogService);
    expect(mocks.service.drain).toHaveBeenCalledOnce();
    expect(mocks.app.close).toHaveBeenCalledOnce();
  });

  it('closes the context after a drain failure without exposing the error', async () => {
    mocks.service.drain.mockRejectedValueOnce(new Error('secret'));

    expect(await runLegacyProcessingBacklog()).toBe(false);
    expect(mocks.app.close).toHaveBeenCalledOnce();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.not.stringContaining('secret'),
    );
  });

  it('reports invalid configuration without booting the module', async () => {
    mocks.loadEnv.mockImplementationOnce(() => {
      throw new Error('invalid environment');
    });

    expect(await runLegacyProcessingBacklog()).toBe(false);
    expect(mocks.createContext).not.toHaveBeenCalled();
  });

  it('reports a bootstrap failure', async () => {
    mocks.createContext.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    expect(await runLegacyProcessingBacklog()).toBe(false);
    expect(mocks.app.close).not.toHaveBeenCalled();
  });
});
