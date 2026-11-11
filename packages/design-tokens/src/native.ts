import source from './tokens.json';

export const designTokens = {
  typography: source.typography,
} as const;

export type DesignTokens = typeof designTokens;
