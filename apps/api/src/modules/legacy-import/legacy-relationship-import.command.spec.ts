import { Logger } from '@nestjs/common';
import { runLegacyRelationshipImport } from './legacy-relationship-import.command.js';
import { LegacyRelationshipImportModule } from './legacy-relationship-import.module.js';
import { LegacyRelationshipImportService } from './legacy-relationship-import.service.js';

const mocks = vi.hoisted(() => {
  const service = { run: vi.fn() };
  const app = { get: vi.fn(() => service), close: vi.fn() };
  return {
    service,
    app,
    createContext: vi.fn(async () => app),
    loadEnv: vi.fn(() => ({ NODE_ENV: 'test' })),
    loadLegacyImportEnv: vi.fn(() => ({ NODE_ENV: 'test' })),
  };
});

vi.mock('@nestjs/core', () => ({
  NestFactory: { createApplicationContext: mocks.createContext },
}));
vi.mock('../../config/env.js', () => ({
  loadEnv: mocks.loadEnv,
  loadLegacyImportEnv: mocks.loadLegacyImportEnv,
}));
vi.mock('./legacy-relationship-import.module.js', () => ({
  LegacyRelationshipImportModule: class {},
}));
vi.mock('./legacy-relationship-import.service.js', () => ({
  LegacyRelationshipImportService: class {},
}));

describe('runLegacyRelationshipImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mocks.createContext.mockResolvedValue(mocks.app);
    mocks.app.close.mockResolvedValue(undefined);
    mocks.service.run.mockResolvedValue({ status: 'complete' });
  });

  afterEach(() => vi.restoreAllMocks());

  it('runs the import and closes its operator context', async () => {
    expect(await runLegacyRelationshipImport()).toBe(true);
    expect(mocks.loadEnv).toHaveBeenCalledOnce();
    expect(mocks.loadLegacyImportEnv).toHaveBeenCalledOnce();
    expect(mocks.createContext).toHaveBeenCalledWith(
      LegacyRelationshipImportModule,
      expect.objectContaining({ abortOnError: false }),
    );
    expect(mocks.app.get).toHaveBeenCalledWith(LegacyRelationshipImportService);
    expect(mocks.app.close).toHaveBeenCalledOnce();
  });

  it('returns false for an incomplete import and closes its context', async () => {
    mocks.service.run.mockResolvedValueOnce({ status: 'incomplete' });
    expect(await runLegacyRelationshipImport()).toBe(false);
    expect(mocks.app.close).toHaveBeenCalledOnce();
  });

  it('closes the context and hides details when the service fails', async () => {
    mocks.service.run.mockRejectedValueOnce(new Error('source secret'));
    expect(await runLegacyRelationshipImport()).toBe(false);
    expect(mocks.app.close).toHaveBeenCalledOnce();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.not.stringContaining('source secret'),
    );
  });

  it('does not create a context when environment validation fails', async () => {
    mocks.loadLegacyImportEnv.mockImplementationOnce(() => {
      throw new Error('invalid environment');
    });
    expect(await runLegacyRelationshipImport()).toBe(false);
    expect(mocks.createContext).not.toHaveBeenCalled();
  });

  it('reports application bootstrap failure without attempting context cleanup', async () => {
    mocks.createContext.mockRejectedValueOnce(new Error('bootstrap failed'));
    expect(await runLegacyRelationshipImport()).toBe(false);
    expect(mocks.app.close).not.toHaveBeenCalled();
  });
});
