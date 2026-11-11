import { designTokens } from '@vozzify/design-tokens/native';
import source from '../../../packages/design-tokens/src/tokens.json';

function cssLengthToPixels(value: string) {
  const number = Number.parseFloat(value);
  return value.endsWith('rem') ? number * 16 : number;
}

describe('native design token projection', () => {
  it('converts source radii and spacing to React Native pixel values', () => {
    for (const [name, value] of Object.entries(source.radii)) {
      expect(designTokens.radii[name as keyof typeof designTokens.radii]).toBe(
        cssLengthToPixels(value),
      );
    }

    for (const [name, value] of Object.entries(source.spacing)) {
      expect(
        designTokens.spacing[name as keyof typeof designTokens.spacing],
      ).toBe(cssLengthToPixels(value));
    }
  });

  it('keeps native palette and font intent aligned to source', () => {
    expect(designTokens.colors.light).toEqual(source.themes.light);
    expect(designTokens.colors.dark).toEqual(source.themes.dark);
    expect(designTokens.typography).toEqual(source.typography);
  });
});
