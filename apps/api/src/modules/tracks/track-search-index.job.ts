import { z } from 'zod';

export const TRACK_SEARCH_INDEX_QUEUE = 'track-search-index';
export const DELIVER_TRACK_SEARCH_INDEX_JOB = 'deliver-track-search-index';
export const TRACK_SEARCH_INDEX_SCHEDULER_ID =
  'deliver-track-search-index-every-five-seconds';
export const TRACK_SEARCH_INDEX_POLL_INTERVAL_MS = 5_000;
export const TRACK_SEARCH_INDEX_BATCH_SIZE = 50;
export const TRACK_SEARCH_INDEX_CLAIM_LEASE_MS = 60_000;

export const deliverTrackSearchIndexJobSchema = z.object({});
