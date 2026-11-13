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

  it('honors explicit permission choices when GDPR consent does not apply', () => {
    const nonGdprConsent = {
      ...consent,
      gdprApplies: false,
      purpose: {
        ...consent.purpose,
        legitimateInterests: {
          2: false,
          7: false,
          9: false,
          10: false,
        },
      },
      vendor: {
        consents: { 755: true },
        legitimateInterests: { 755: false },
      },
    };
    expect(adConsentFromTcf(nonGdprConsent)).toBe('personalized');
    expect(
      adConsentFromTcf({
        ...nonGdprConsent,
        purpose: {
          ...nonGdprConsent.purpose,
          consents: { ...nonGdprConsent.purpose.consents, 3: false },
        },
      }),
    ).toBe('non-personalized');
    expect(
      adConsentFromTcf({
        ...nonGdprConsent,
        purpose: {
          ...nonGdprConsent.purpose,
          consents: { ...nonGdprConsent.purpose.consents, 1: false },
        },
      }),
    ).toBe('denied');
  });

  it('uses non-personalized ads for reduced non-GDPR TCData', () => {
    expect(adConsentFromTcf({ gdprApplies: false })).toBe('non-personalized');
    expect(
      adConsentFromTcf({
        gdprApplies: false,
        purpose: { consents: { 1: false } },
      }),
    ).toBe('denied');
    expect(
      adConsentFromTcf({
        gdprApplies: false,
        vendor: { consents: { 755: false } },
      }),
    ).toBe('denied');
    expect(
      adConsentFromTcf({
        gdprApplies: false,
        publisher: { restrictions: { 2: { 755: 0 } } },
      }),
    ).toBe('denied');
    expect(
      adConsentFromTcf({
        gdprApplies: false,
        purpose: {
          consents: {
            1: true,
            2: false,
            3: false,
            4: false,
            7: false,
            9: false,
            10: false,
          },
          legitimateInterests: { 2: true, 7: true, 9: true, 10: true },
        },
        vendor: {
          consents: { 755: true },
          legitimateInterests: { 755: false },
        },
      }),
    ).toBe('denied');
    expect(
      adConsentFromTcf({
        gdprApplies: false,
        eventStatus: 'cmpuishown',
      }),
    ).toBeUndefined();
  });

  it('honors allowed legitimate interest and publisher restrictions for required purposes', () => {
    expect(
      adConsentFromTcf({
        ...consent,
        purpose: {
          consents: { 1: true, 3: false, 4: false },
          legitimateInterests: { 2: true, 7: true, 9: true, 10: true },
        },
        vendor: {
          consents: { 755: true },
          legitimateInterests: { 755: true },
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
        publisher: { restrictions: { 4: { 755: 0 } } },
      }),
    ).toBe('non-personalized');
    expect(
      adConsentFromTcf({
        ...consent,
        purpose: {
          consents: { 1: true, 3: true, 4: true },
          legitimateInterests: { 2: true, 7: true, 9: true, 10: true },
        },
        vendor: {
          consents: { 755: true },
          legitimateInterests: { 755: false },
        },
      }),
    ).toBe('denied');
  });

  it('requires Google vendor consent while allowing purpose legal bases', () => {
    expect(
      adConsentFromTcf({
        ...consent,
        purpose: {
          consents: { 1: true, 3: true, 4: true },
          legitimateInterests: { 2: true, 7: true, 9: true, 10: true },
        },
        vendor: {
          consents: { 755: false },
          legitimateInterests: { 755: true },
        },
      }),
    ).toBe('denied');
    expect(
      adConsentFromTcf({
        ...consent,
        purpose: {
          consents: { 1: true, 3: true, 4: true },
          legitimateInterests: { 2: true, 7: true, 9: true, 10: true },
        },
        vendor: {
          consents: { 755: true },
          legitimateInterests: { 755: false },
        },
      }),
    ).toBe('denied');
  });

  it('does not use restricted storage or personalization purposes', () => {
    const restrictedPurposeOne = {
      ...consent,
      publisher: { restrictions: { 1: { 755: 0 as const } } },
    };
    expect(adConsentFromTcf(restrictedPurposeOne)).toBe('denied');
    expect(
      adConsentFromTcf({
        ...consent,
        publisher: { restrictions: { 3: { 755: 0 } } },
      }),
    ).toBe('non-personalized');
    expect(
      adConsentFromTcf({
        ...consent,
        publisher: { restrictions: { 4: { 755: 0 } } },
      }),
    ).toBe('non-personalized');
  });
});
