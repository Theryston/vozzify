import { testMbid } from '../../../test/utils/factories.js';
import { recordingFixture } from '../../../test/utils/recording-fixtures.js';
import { trackRowsFromRecording } from './track-from-recording.js';

describe('the catalog cover identity', () => {
  it('preserves the catalog choice before dates are reduced to years', () => {
    const release = (id: number, title: string, date: string | null) => ({
      mbid: testMbid(id),
      title,
      date,
      releaseGroup: { mbid: testMbid(20), primaryType: 'Single' },
      status: 'Official',
      country: 'GB',
      mediumPosition: 1,
      trackPosition: 1,
      coverArtUrl: `https://coverartarchive.org/release/${testMbid(id)}/front-500`,
    });
    const recording = recordingFixture({
      releases: [
        release(10, 'Shape of You', '2017-01-06'),
        release(11, 'Bravo: The Hits 2017', '2017-11-10'),
        release(12, 'An undated compilation', null),
      ],
    });

    expect(trackRowsFromRecording(recording).track).toMatchObject({
      primaryReleaseMbid: testMbid(10),
    });
  });

  it('keeps an unknown cover identity when the catalog has no releases', () => {
    expect(trackRowsFromRecording(recordingFixture()).track).toMatchObject({
      primaryReleaseMbid: null,
    });
  });
});
