import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { generateTokenCss } from './generate-css.mjs';

const source = JSON.parse(
  await readFile(new URL('../src/tokens.json', import.meta.url), 'utf8'),
);
const { webCss, nativeCss } = generateTokenCss(source);

test('emits every source palette value into both platform adapters', () => {
  for (const [theme, values] of Object.entries(source.themes)) {
    for (const [name, value] of Object.entries(values)) {
      assert.ok(webCss.includes(`--token-${name}: ${value};`));
      assert.ok(
        nativeCss.includes(`--token-color-${name}-${theme}: ${value};`),
      );
    }
  }

  for (const name of Object.keys(source.themes.light)) {
    assert.ok(
      nativeCss.includes(
        `--color-${name}: light-dark(\n    var(--token-color-${name}-light),\n    var(--token-color-${name}-dark)\n  );`,
      ),
    );
  }
});

test('projects shape, spacing, and motion tokens into both adapters', () => {
  for (const [name, value] of Object.entries(source.radii)) {
    assert.ok(webCss.includes(`--token-radius-${name}: ${value};`));
    assert.ok(nativeCss.includes(`--radius-${name}: ${value};`));
  }

  for (const [name, value] of Object.entries(source.spacing)) {
    assert.ok(webCss.includes(`--token-space-${name}: ${value};`));
    assert.ok(nativeCss.includes(`--spacing-${name}: ${value};`));
  }

  for (const [name, value] of Object.entries(source.motion)) {
    assert.ok(webCss.includes(`--token-motion-${name}: ${value};`));
  }

  assert.ok(nativeCss.includes(`--ease-spring: var(--token-motion-spring);`));
  assert.ok(
    nativeCss.includes(`--ease-out-soft: var(--token-motion-out-soft);`),
  );
});

test('checked-in platform adapters match current source generation', async () => {
  const [checkedWebCss, checkedNativeCss] = await Promise.all([
    readFile(new URL('../src/tokens.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/native.css', import.meta.url), 'utf8'),
  ]);

  assert.equal(checkedWebCss, webCss);
  assert.equal(checkedNativeCss, nativeCss);
});
