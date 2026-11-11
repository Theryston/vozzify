import { designTokens } from '@vozzify/design-tokens/native';

const sans = designTokens.typography.sans;
const mono = designTokens.typography.mono.replaceAll(' ', '');

export const nativeFontFamilies = {
  regular: `${sans}_400Regular`,
  medium: `${sans}_500Medium`,
  semibold: `${sans}_600SemiBold`,
  bold: `${sans}_700Bold`,
  extrabold: `${sans}_800ExtraBold`,
  mono: `${mono}_400Regular`,
} as const;
