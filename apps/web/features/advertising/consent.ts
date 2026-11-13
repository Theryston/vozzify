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
  };
  publisher?: {
    restrictions?: Record<number, Record<number, 0 | 1 | 2>>;
  };
};

export type AdConsent = 'personalized' | 'non-personalized' | 'denied';
export type PublisherRestrictions = Record<number, Record<number, 0 | 1 | 2>>;

const GOOGLE_VENDOR_ID = 755;
const REQUIRED_AD_PURPOSES = [2, 7, 9, 10] as const;

function purposeIsAllowed(data: TcfConsentData, purpose: number): boolean {
  const restriction =
    data.publisher?.restrictions?.[purpose]?.[GOOGLE_VENDOR_ID];
  if (restriction === 0) return false;
  if (restriction === 1) return data.purpose?.consents?.[purpose] === true;
  if (restriction === 2) {
    return data.purpose?.legitimateInterests?.[purpose] === true;
  }
  return (
    data.purpose?.consents?.[purpose] === true ||
    data.purpose?.legitimateInterests?.[purpose] === true
  );
}

/** Require storage consent and an allowed Google vendor basis before requests. */
export function adConsentFromTcf(data: TcfConsentData): AdConsent | undefined {
  if (
    data.eventStatus !== 'tcloaded' &&
    data.eventStatus !== 'useractioncomplete'
  )
    return undefined;
  if (data.gdprApplies === false) {
    const explicitRefusal =
      data.purpose?.consents?.[1] === false ||
      data.vendor?.consents?.[GOOGLE_VENDOR_ID] === false;
    if (explicitRefusal) return 'denied';
    if (
      data.purpose?.consents?.[3] === false ||
      data.purpose?.consents?.[4] === false
    )
      return 'non-personalized';
    return 'personalized';
  }
  if (data.gdprApplies !== true) return undefined;

  const purposes = data.purpose?.consents;
  const storageAllowed = purposes?.[1] === true;
  const googleAllowed = data.vendor?.consents?.[GOOGLE_VENDOR_ID] === true;
  const requiredPurposesAllowed = REQUIRED_AD_PURPOSES.every((purpose) =>
    purposeIsAllowed(data, purpose),
  );
  if (!storageAllowed || !googleAllowed || !requiredPurposesAllowed)
    return 'denied';

  return purposes?.[3] === true && purposes[4] === true
    ? 'personalized'
    : 'non-personalized';
}
