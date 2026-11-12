import {
  detectDeviceLocale,
  parseSavedLocale,
} from '../src/lib/i18n/mobile-locale';

describe('mobile locale selection', () => {
  it('matches English and Brazilian Portuguese device locales', () => {
    expect(detectDeviceLocale('en-US')).toBe('en');
    expect(detectDeviceLocale('pt-BR')).toBe('pt-BR');
    expect(detectDeviceLocale('pt_BR')).toBe('pt-BR');
  });

  it('falls back to English when the device language is unsupported', () => {
    expect(detectDeviceLocale('fr-FR')).toBe('en');
  });

  it('accepts only supported persisted locale values', () => {
    expect(parseSavedLocale('pt-BR')).toBe('pt-BR');
    expect(parseSavedLocale('en')).toBe('en');
    expect(parseSavedLocale('pt-PT')).toBeNull();
    expect(parseSavedLocale(null)).toBeNull();
  });
});
