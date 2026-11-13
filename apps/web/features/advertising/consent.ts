export type TcfConsentData = {
  listenerId?: number;
  eventStatus?: string;
  gdprApplies?: boolean;
  purpose?: {
    consents?: Record<number, boolean>;
    legitimateInterests?: Record<number, boolean>;
  };
  vendor?: {
    consents?: Record<number, boolean>;
    legitimateInterests?: Record<number, boolean>;
  };
  publisher?: {
    restrictions?: Record<number, Record<number, 0 | 1 | 2>>;
  };
};

export type AdConsent = 'personalized' | 'non-personalized' | 'denied';
export type PublisherRestrictions = Record<number, Record<number, 0 | 1 | 2>>;

const GOOGLE_VENDOR_ID = 755;
const REQUIRED_AD_PURPOSES = [2, 7, 9, 10] as const;

type LegalBasis = 'consent' | 'legitimateInterest';

function purposeBasisIsAllowed(
  data: TcfConsentData,
  purpose: number,
  basis: LegalBasis,
): boolean {
  const restriction =
    data.publisher?.restrictions?.[purpose]?.[GOOGLE_VENDOR_ID];
  if (
    restriction === 0 ||
    (restriction === 1 && basis !== 'consent') ||
    (restriction === 2 && basis !== 'legitimateInterest')
  )
    return false;
  const purposeBases =
    basis === 'consent'
      ? data.purpose?.consents
      : data.purpose?.legitimateInterests;
  const vendorBases =
    basis === 'consent'
      ? data.vendor?.consents
      : data.vendor?.legitimateInterests;
  return (
    purposeBases?.[purpose] === true && vendorBases?.[GOOGLE_VENDOR_ID] === true
  );
}

function purposeHasAllowedBasis(
  data: TcfConsentData,
  purpose: number,
): boolean {
  return (
    purposeBasisIsAllowed(data, purpose, 'consent') ||
    purposeBasisIsAllowed(data, purpose, 'legitimateInterest')
  );
}

/** Require storage consent and matching Google vendor/purpose legal bases. */
export function adConsentFromTcf(data: TcfConsentData): AdConsent | undefined {
  if (
    data.eventStatus !== 'tcloaded' &&
    data.eventStatus !== 'useractioncomplete'
  )
    return undefined;
  if (data.gdprApplies !== true && data.gdprApplies !== false) return undefined;

  if (data.vendor?.consents?.[GOOGLE_VENDOR_ID] !== true) return 'denied';
  const storageAllowed = purposeBasisIsAllowed(data, 1, 'consent');
  const requiredPurposesAllowed = REQUIRED_AD_PURPOSES.every((purpose) =>
    purposeHasAllowedBasis(data, purpose),
  );
  if (!storageAllowed || !requiredPurposesAllowed) return 'denied';

  return purposeBasisIsAllowed(data, 3, 'consent') &&
    purposeBasisIsAllowed(data, 4, 'consent')
    ? 'personalized'
    : 'non-personalized';
}
