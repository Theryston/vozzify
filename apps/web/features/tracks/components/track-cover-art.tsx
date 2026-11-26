'use client';

import Image from 'next/image';
import { useState } from 'react';

import { TrackCoverPlaceholder } from './track-cover-placeholder';

/**
 * The art of a Recording, filling its positioned parent. Without art, or when
 * the art fails to load, the geometric placeholder stands in. `sizes` is the
 * rendered width of the art at each breakpoint, so the optimizer picks a
 * close size.
 */
export function TrackCoverArt({
  coverArtUrl,
  placeholderSeed,
  sizes,
  priority,
  unoptimized,
}: {
  coverArtUrl?: string | null;
  placeholderSeed: string;
  sizes: string;
  /** Loads the art eagerly; only for covers visible on first paint. */
  priority?: boolean;
  unoptimized?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  if (!coverArtUrl || coverArtUrl === failedUrl) {
    return <TrackCoverPlaceholder seed={placeholderSeed} />;
  }
  return (
    <Image
      key={coverArtUrl}
      src={coverArtUrl}
      alt=""
      fill
      priority={priority}
      unoptimized={unoptimized}
      sizes={sizes}
      className="object-cover"
      onError={() => setFailedUrl(coverArtUrl)}
    />
  );
}
