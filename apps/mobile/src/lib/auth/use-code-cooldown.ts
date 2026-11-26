import type { AuthCodePurpose } from '@vozzify/contracts';
import { useEffect, useState } from 'react';

const timestamps = new Map<string, number>();
const cooldown = 60_000;

function secondsLeft(sentAt: number, now: number) {
  return Math.max(0, Math.ceil((sentAt + cooldown - now) / 1000));
}

function codeKey(email: string, purpose: AuthCodePurpose) {
  return `${purpose}:${email.trim().toLowerCase()}`;
}

export function recordCodeSent(
  email: string,
  purpose: AuthCodePurpose,
  time: number,
) {
  timestamps.set(codeKey(email, purpose), time);
}

export function isCodeCoolingDown(email: string, purpose: AuthCodePurpose) {
  return (
    secondsLeft(timestamps.get(codeKey(email, purpose)) ?? 0, Date.now()) > 0
  );
}

export function useCodeCooldown(
  email: string,
  purpose: AuthCodePurpose,
  initialSentAt = 0,
) {
  const [now, setNow] = useState(Date.now);
  const sentAt = Math.max(
    initialSentAt,
    timestamps.get(codeKey(email, purpose)) ?? 0,
  );
  const seconds = secondsLeft(sentAt, now);
  useEffect(() => {
    if (secondsLeft(sentAt, now) === 0) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [now, sentAt]);
  return {
    seconds,
    restart: () => {
      const time = Date.now();
      recordCodeSent(email, purpose, time);
      setNow(time);
      return time;
    },
  };
}
