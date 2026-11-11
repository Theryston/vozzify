import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packageDirectory = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(
  await readFile(new URL('../src/tokens.json', import.meta.url), 'utf8'),
);

function themeCss(name, values) {
  const selector = name === 'light' ? ':root' : '.dark';
  const declarations = Object.entries(values)
    .map(([key, value]) => `  --token-${key}: ${value};`)
    .join('\n');

  return `${selector} {\n${declarations}\n}`;
}

function tokenDeclarations(prefix, values) {
  return Object.entries(values)
    .map(([key, value]) => `  --${prefix}-${key}: ${value};`)
    .join('\n');
}

const commonCss = `:root {\n  --token-font-sans: "${source.typography.sans}";\n  --token-font-mono: "${source.typography.mono}";\n${tokenDeclarations('token-radius', source.radii)}\n${tokenDeclarations('token-space', source.spacing)}\n${tokenDeclarations('token-motion', source.motion)}\n}`;

const css = [
  themeCss('light', source.themes.light),
  themeCss('dark', source.themes.dark),
  commonCss,
].join('\n\n');

const nativeColorValues = [
  ...Object.entries(source.themes.light).map(
    ([key, value]) => `  --token-color-${key}-light: ${value};`,
  ),
  ...Object.entries(source.themes.dark).map(
    ([key, value]) => `  --token-color-${key}-dark: ${value};`,
  ),
].join('\n');
const nativeColorTheme = Object.keys(source.themes.light)
  .map(
    (key) =>
      `  --color-${key}: light-dark(\n    var(--token-color-${key}-light),\n    var(--token-color-${key}-dark)\n  );`,
  )
  .join('\n');
const nativeTheme = `@theme inline {\n${nativeColorTheme}\n  --font-sans: var(--token-font-sans);\n  --font-mono: var(--token-font-mono);\n${tokenDeclarations('radius', source.radii)}\n${tokenDeclarations('spacing', source.spacing)}\n  --ease-spring: var(--token-motion-spring);\n  --ease-out-soft: var(--token-motion-out-soft);\n}`;
const nativeCss = `${commonCss.replace(/:root \{/, `:root {\n${nativeColorValues}`)}\n\n${nativeTheme}\n`;

const generatedFiles = [
  [`${packageDirectory}src/tokens.css`, `${css}\n`],
  [`${packageDirectory}src/native.css`, nativeCss],
];

if (process.argv.includes('--check')) {
  for (const [filePath, generatedContent] of generatedFiles) {
    const checkedInContent = await readFile(filePath, 'utf8');

    if (checkedInContent !== generatedContent) {
      throw new Error(
        `${filePath} is out of date. Run the design-token build.`,
      );
    }
  }
} else {
  for (const [filePath, generatedContent] of generatedFiles) {
    await writeFile(filePath, generatedContent);
  }
}
