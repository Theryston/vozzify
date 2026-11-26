import { youtubeVideoIdOf } from './youtube-video-id.js';

const ID = 'dQw4w9WgXcQ';

describe('youtubeVideoIdOf', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}?feature=share`,
  ])('reads the video ID of %s', (url) => {
    expect(youtubeVideoIdOf(url)).toBe(ID);
  });

  it('refuses a YouTube page that names no video', () => {
    expect(youtubeVideoIdOf('https://www.youtube.com/')).toBeUndefined();
    expect(
      youtubeVideoIdOf('https://www.youtube.com/watch?list=PL123'),
    ).toBeUndefined();
    expect(youtubeVideoIdOf('https://youtu.be/')).toBeUndefined();
  });

  it('refuses an ID of the wrong shape', () => {
    expect(
      youtubeVideoIdOf('https://www.youtube.com/watch?v=too-short'),
    ).toBeUndefined();
  });

  it('refuses a link to another site', () => {
    expect(
      youtubeVideoIdOf(`https://example.com/watch?v=${ID}`),
    ).toBeUndefined();
    expect(youtubeVideoIdOf('https://open.spotify.com/track/abc')).toBe(
      undefined,
    );
  });

  it('refuses text that is not a URL', () => {
    expect(youtubeVideoIdOf('not a url')).toBeUndefined();
  });

  it.each([
    `ftp://youtube.com/watch?v=${ID}`,
    `https://user@youtube.com/watch?v=${ID}`,
    `https://youtube.com:8080/watch?v=${ID}`,
    `https://youtu.be/${ID}/unexpected`,
    `https://youtube.com/shorts/${ID}/unexpected`,
  ])('refuses an unexpected video link form (%s)', (url) => {
    expect(youtubeVideoIdOf(url)).toBeUndefined();
  });
});
