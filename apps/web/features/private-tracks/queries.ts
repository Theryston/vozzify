import 'server-only';

import { privateTrackDetailSchema } from '@vozzify/contracts';
import { cache } from 'react';
import { isApiError } from '@/lib/api/api-error';
import { serverApi } from '@/lib/api/server';

export const getPrivateTrackDetail = cache(async (trackId: string) => {
  try {
    return await serverApi(
      `/me/private-tracks/${encodeURIComponent(trackId)}`,
      { schema: privateTrackDetailSchema, forwardCookies: true },
    );
  } catch (error) {
    if (
      isApiError(error) &&
      (error.statusCode === 401 || error.statusCode === 404)
    ) {
      return null;
    }
    throw error;
  }
});
