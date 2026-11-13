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

function hasCompleteTcfBasis(data: TcfConsentData): boolean {
  return (
    typeof data.purpose?.consents?.[1] === 'boolean' &&
    typeof data.vendor?.consents?.[GOOGLE_VENDOR_ID] === 'boolean' &&
    typeof data.vendor?.legitimateInterests?.[GOOGLE_VENDOR_ID] === 'boolean' &&
    REQUIRED_AD_PURPOSES.every(
      (purpose) =>
        typeof data.purpose?.consents?.[purpose] === 'boolean' &&
        typeof data.purpose?.legitimateInterests?.[purpose] === 'boolean',
    ) &&
    typeof data.purpose?.consents?.[3] === 'boolean' &&
    typeof data.purpose?.consents?.[4] === 'boolean'
  );
}

function nonGdprChoice(data: TcfConsentData): AdConsent {
  const restrictions = data.publisher?.restrictions;
  const purposeOneRestriction = restrictions?.[1]?.[GOOGLE_VENDOR_ID];
  if (
    data.vendor?.consents?.[GOOGLE_VENDOR_ID] === false ||
    data.purpose?.consents?.[1] === false ||
    purposeOneRestriction === 0 ||
    purposeOneRestriction === 2
  )
    return 'denied';

  if (
    REQUIRED_AD_PURPOSES.some(
      (purpose) => restrictions?.[purpose]?.[GOOGLE_VENDOR_ID] === 0,
    )
  )
    return 'denied';

  if (!hasCompleteTcfBasis(data)) return 'non-personalized';
  const requiredPurposesAllowed = REQUIRED_AD_PURPOSES.every((purpose) =>
    purposeHasAllowedBasis(data, purpose),
  );
  if (
    data.vendor?.consents?.[GOOGLE_VENDOR_ID] !== true ||
    !purposeBasisIsAllowed(data, 1, 'consent') ||
    !requiredPurposesAllowed
  )
    return 'denied';
  return purposeBasisIsAllowed(data, 3, 'consent') &&
    purposeBasisIsAllowed(data, 4, 'consent')
    ? 'personalized'
    : 'non-personalized';
}

/** Require storage consent and matching Google vendor/purpose legal bases. */
export function adConsentFromTcf(data: TcfConsentData): AdConsent | undefined {
  if (data.gdprApplies !== true && data.gdprApplies !== false) return undefined;
  if (
    data.eventStatus !== undefined &&
    data.eventStatus !== 'tcloaded' &&
    data.eventStatus !== 'useractioncomplete'
  )
    return undefined;
  if (data.gdprApplies === false) return nonGdprChoice(data);
  if (data.eventStatus === undefined) return undefined;

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
