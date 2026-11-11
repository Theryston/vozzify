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

export function generateTokenCss(source) {
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

  return { webCss: `${css}\n`, nativeCss };
}
