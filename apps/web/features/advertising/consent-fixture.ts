import type { TcfConsentData } from './consent';

export const allowedAdConsent: TcfConsentData = {
  gdprApplies: true,
  eventStatus: 'tcloaded',
  purpose: {
    consents: {
      1: true,
      2: true,
      3: true,
      4: true,
      7: true,
      9: true,
      10: true,
    },
  },
  vendor: { consents: { 755: true } },
};
