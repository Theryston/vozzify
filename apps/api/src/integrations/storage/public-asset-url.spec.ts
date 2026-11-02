import { S3StorageService } from './s3-storage.service.js';

describe('public asset URL configuration', () => {
  it('uses the asset proxy prefix configured for production', () => {
    const storage = new S3StorageService(
      { send: vi.fn(), destroy: vi.fn() },
      {
        bucket: 'vozzify',
        publicUrl: 'https://assets.vozzify.com/storage',
      },
    );

    expect(storage.publicUrl('track-audio/track-1.wav')).toBe(
      'https://assets.vozzify.com/storage/track-audio/track-1.wav',
    );
  });
});
