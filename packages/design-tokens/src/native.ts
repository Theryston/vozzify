import source from './tokens.json';

type ColorName = keyof typeof source.themes.light;
type ThemeName = keyof typeof source.themes;

function pixels(value: string) {
  const parsed = Number.parseFloat(value);
  return value.endsWith('rem') ? parsed * 16 : parsed;
}

export const designTokens = {
  colors: source.themes as Record<ThemeName, Record<ColorName, string>>,
  typography: source.typography,
  radii: Object.fromEntries(
    Object.entries(source.radii).map(([name, value]) => [name, pixels(value)]),
  ),
  spacing: Object.fromEntries(
    Object.entries(source.spacing).map(([name, value]) => [
      name,
      pixels(value),
    ]),
  ),
  motion: source.motion,
} as const;

export type DesignTokens = typeof designTokens;
