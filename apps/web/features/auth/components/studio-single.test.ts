import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';
import { UserAvatar } from './user-avatar';

describe('a Pro User’s public Avatar', () => {
  it('puts the initials on the sleeve and Pro on the record when there is no image', () => {
    const user = {
      name: 'Lia Costa',
      username: 'lia',
      avatarIdentity: { pro: true },
    };
    const html = renderToStaticMarkup(
      createElement(NextIntlClientProvider, {
        locale: 'en',
        messages,
        timeZone: 'UTC',
        // biome-ignore lint/correctness/noChildrenProp: the typed provider requires children in its props.
        children: createElement(UserAvatar, { user, size: 'full' }),
      }),
    );
    expect(html).toContain('>Pro<');
    expect(html).toContain('>LC<');
  });
});
