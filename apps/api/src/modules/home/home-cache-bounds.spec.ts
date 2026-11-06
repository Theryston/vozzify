import {
  HOME_FEED_RETAINED_TTL_SECONDS,
  PUBLIC_HOME_CACHE_CONTROL,
} from './home-rules.js';

describe('Home cache bounds', () => {
  it('retains cursors longer than the public shared cache can serve page one', () => {
    const directives = Object.fromEntries(
      PUBLIC_HOME_CACHE_CONTROL.split(', ').map((directive) => {
        const [name, value] = directive.split('=');
        return [name, Number(value)];
      }),
    );
    const sharedLifetime =
      (directives['s-maxage'] ?? 0) +
      (directives['stale-while-revalidate'] ?? 0);

    expect(sharedLifetime).toBe(60 * 60);
    expect(HOME_FEED_RETAINED_TTL_SECONDS).toBeGreaterThan(sharedLifetime);
  });
});
