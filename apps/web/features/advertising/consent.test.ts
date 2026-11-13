import { describe, expect, it } from 'vitest';

import { adConsentFromTcf } from './consent';
import { allowedAdConsent } from './consent-fixture';

const consent = allowedAdConsent;

describe('adConsentFromTcf', () => {
  it('allows personalized ads when required purposes and Google consent are present', () => {
    expect(adConsentFromTcf(consent)).toBe('personalized');
  });

  it('allows non-personalized ads after storage consent when personalization is declined', () => {
    expect(
      adConsentFromTcf({
        ...consent,
        purpose: {
          consents: {
            1: true,
            2: true,
            3: false,
            4: false,
            7: true,
            9: true,
            10: true,
          },
        },
      }),
    ).toBe('non-personalized');
  });

  it('withholds ads when storage consent or Google vendor permission is missing', () => {
    expect(
      adConsentFromTcf({ ...consent, purpose: { consents: { 1: false } } }),
    ).toBe('denied');
    expect(adConsentFromTcf({ ...consent, vendor: { consents: {} } })).toBe(
      'denied',
    );
  });

  it('waits for an explicit choice when the TCF state is unresolved', () => {
    expect(
      adConsentFromTcf({ gdprApplies: true, eventStatus: 'cmpuishown' }),
    ).toBeUndefined();
    expect(adConsentFromTcf({ ...consent, gdprApplies: undefined })).toBe(
      undefined,
    );
  });

  it('allows ads when GDPR consent does not apply', () => {
    expect(
      adConsentFromTcf({ gdprApplies: false, eventStatus: 'tcloaded' }),
    ).toBe('personalized');
    expect(
      adConsentFromTcf({
        gdprApplies: false,
        eventStatus: 'useractioncomplete',
        purpose: { consents: { 3: false } },
      }),
    ).toBe('non-personalized');
    expect(
      adConsentFromTcf({
        gdprApplies: false,
        eventStatus: 'useractioncomplete',
        purpose: { consents: { 1: false } },
      }),
    ).toBe('denied');
  });

  it('honors allowed legitimate interest and publisher restrictions for required purposes', () => {
    expect(
      adConsentFromTcf({
        ...consent,
        purpose: {
          consents: { 1: true, 3: false, 4: false },
          legitimateInterests: { 2: true, 7: true, 9: true, 10: true },
        },
      }),
    ).toBe('non-personalized');
    expect(
      adConsentFromTcf({
        ...consent,
        publisher: { restrictions: { 7: { 755: 0 } } },
      }),
    ).toBe('denied');
    expect(
      adConsentFromTcf({
        ...consent,
        publisher: { restrictions: { 7: { 755: 1 } } },
      }),
    ).toBe('personalized');
    expect(
      adConsentFromTcf({
        ...consent,
        publisher: { restrictions: { 7: { 755: 2 } } },
      }),
    ).toBe('denied');
  });
});
