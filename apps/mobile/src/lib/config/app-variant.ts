import appVariants from './app-variants.json';

export { appVariants };

export type AppVariant = keyof typeof appVariants;

export function parseAppVariant(value: string | undefined): AppVariant {
  if (value === undefined || value === '') return 'development';
  if (Object.hasOwn(appVariants, value)) return value as AppVariant;
  throw new Error(
    `APP_VARIANT must be development, preview, or production; received ${value}`,
  );
}
