import { renderTrackCompletedEmail } from './track-processing-email.js';

describe('track processing email typography', () => {
  it('resets display-heading tracking on the artist and keeps the range together', () => {
    const { html } = renderTrackCompletedEmail({
      to: 'singer@example.com',
      locale: 'pt-BR',
      webUrl: 'https://vozzify.test',
      trackUrl: 'https://vozzify.test/pt-BR/tracks/the-a-team',
      track: {
        title: 'The A Team',
        artistCredit: [{ name: 'Ed Sheeran', joinPhrase: '' }],
        coverUrl: null,
        vocalRange: { lowest: 45, highest: 69 },
      },
    });

    expect(html).toMatch(
      /<p style="[^"]*font-size:15px;[^"]*font-weight:600;letter-spacing:normal;[^"]*">Ed Sheeran/,
    );
    expect(html).toMatch(
      /<span style="[^"]*white-space:nowrap;[^"]*">A2–A4<\/span>/,
    );
  });
});
