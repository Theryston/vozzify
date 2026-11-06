import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StructuredData } from './structured-data';

describe('structured data markup', () => {
  it('escapes script-closing catalog text while preserving valid JSON', () => {
    const name = '</script><script>alert("catalog")</script>';
    const data = { '@type': 'MusicRecording', name };
    const markup = renderToStaticMarkup(
      createElement(StructuredData, { data }),
    );

    expect(markup).toContain('type="application/ld+json"');
    expect(markup.match(/<script/g)).toHaveLength(1);
    expect(markup.match(/<\/script>/g)).toHaveLength(1);
    expect(markup).toContain('\\u003c/script>');
    const json = markup.slice(markup.indexOf('>') + 1, markup.lastIndexOf('<'));
    expect(JSON.parse(json)).toEqual(data);
  });
});
