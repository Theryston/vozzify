import { NotFoundPage } from '@/components/not-found-page';
import { TrackClickIdUrlCleaner } from '@/features/tracks/components/track-click-id-url-cleaner';

export default function TrackNotFound() {
  return (
    <>
      <TrackClickIdUrlCleaner />
      <NotFoundPage />
    </>
  );
}
