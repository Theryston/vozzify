import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { generateTokenCss } from './generate-css.mjs';

const packageDirectory = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(
  await readFile(new URL('../src/tokens.json', import.meta.url), 'utf8'),
);
const { webCss, nativeCss } = generateTokenCss(source);

const generatedFiles = [
  [`${packageDirectory}src/tokens.css`, webCss],
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
