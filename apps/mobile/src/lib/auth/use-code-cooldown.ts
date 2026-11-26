import AsyncStorage from '@react-native-async-storage/async-storage';
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

function recoveryStorageKey(email: string) {
  return `vozzify.auth-code:${codeKey(email, 'forget-password')}`;
}

async function readRecoveryCodeSentAt(email: string) {
  const key = recoveryStorageKey(email);
  const stored = Number(await AsyncStorage.getItem(key).catch(() => null));
  return Number.isSafeInteger(stored) && stored <= Date.now() ? stored : 0;
}

export async function recordRecoveryCodeSent(email: string, time: number) {
  try {
    await AsyncStorage.setItem(recoveryStorageKey(email), String(time));
  } catch {
    recordCodeSent(email, 'forget-password', time);
  }
}

export async function isRecoveryCodeCoolingDown(email: string) {
  const cached = timestamps.get(codeKey(email, 'forget-password')) ?? 0;
  const restored = await readRecoveryCodeSentAt(email);
  return secondsLeft(Math.max(cached, restored), Date.now()) > 0;
}

function useRecoveryCodeSentAt(email: string, purpose: AuthCodePurpose) {
  const [restored, setRestored] = useState<{ email: string; time: number }>();
  useEffect(() => {
    if (purpose !== 'forget-password') return;
    let active = true;
    void readRecoveryCodeSentAt(email).then((time) => {
      if (active) setRestored({ email, time });
    });
    return () => {
      active = false;
    };
  }, [email, purpose]);
  return {
    time: restored?.email === email ? restored.time : undefined,
    setTime: (time: number) => setRestored({ email, time }),
  };
}

export function useCodeCooldown(
  email: string,
  purpose: AuthCodePurpose,
  initialSentAt = 0,
) {
  const [now, setNow] = useState(Date.now);
  const recovery = useRecoveryCodeSentAt(email, purpose);
  const sentAt = Math.max(
    initialSentAt,
    timestamps.get(codeKey(email, purpose)) ?? 0,
    recovery.time ?? 0,
  );
  const seconds = secondsLeft(sentAt, now);
  const coolingDown = seconds > 0;
  useEffect(() => {
    if (!coolingDown) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [coolingDown]);
  return {
    seconds,
    ready: purpose !== 'forget-password' || recovery.time !== undefined,
    restart: async () => {
      const time = Date.now();
      setNow(time);
      if (purpose === 'forget-password') {
        recovery.setTime(time);
        await recordRecoveryCodeSent(email, time);
      } else {
        recordCodeSent(email, purpose, time);
      }
      return time;
    },
  };
}
