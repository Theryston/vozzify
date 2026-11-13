import { expect, test } from '@playwright/test';

for (const locale of ['en', 'pt-BR']) {
  for (const path of ['', '/sign-in']) {
    test(`${locale}${path}: includes AdSense verification in the server-rendered head`, async ({
      request,
    }) => {
      const response = await request.get(`/${locale}${path}`);

      expect(response.ok()).toBe(true);
      const html = await response.text();
      const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
      expect(head).toContain(
        '<meta name="google-adsense-account" content="ca-pub-9375786333422765"/>',
      );
    });
  }
}
