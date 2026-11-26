import { Inject, Injectable } from '@nestjs/common';
import { type Mbid, mbidSchema } from '@vozzify/contracts';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { confidentRecordingMbid } from './acoustid-match.js';

const REQUEST_TIMEOUT_MS = 8_000;
const lookupResponseSchema = z.object({
  status: z.literal('ok'),
  results: z.array(
    z.object({
      score: z.number().min(0).max(1),
      recordings: z.array(z.object({ id: mbidSchema })).optional(),
    }),
  ),
});

@Injectable()
export class AcoustidClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  isConfigured(): boolean {
    return Boolean(
      this.env.ACOUSTID_LOOKUP_URL && this.env.ACOUSTID_COMMERCIAL_API_KEY,
    );
  }

  async lookup(fingerprint: string, durationMs: number): Promise<Mbid | null> {
    const url = this.env.ACOUSTID_LOOKUP_URL;
    const key = this.env.ACOUSTID_COMMERCIAL_API_KEY;
    if (!url || !key) return null;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Acoustid-App-Key': key },
      body: new URLSearchParams({
        fingerprint,
        duration: String(Math.max(1, Math.round(durationMs / 1_000))),
        meta: 'recordingids',
        format: 'json',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`AcoustID lookup returned HTTP ${response.status}`);
    }
    const parsed = lookupResponseSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new Error('AcoustID returned an invalid lookup result');
    return confidentRecordingMbid(parsed.data.results);
  }
}
