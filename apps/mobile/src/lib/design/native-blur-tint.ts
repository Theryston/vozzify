import type { ColorSchemeName } from 'react-native';

export function nativeBlurTint(colorScheme: ColorSchemeName | null) {
  return colorScheme === 'dark' ? 'systemMaterialDark' : 'systemMaterialLight';
}
