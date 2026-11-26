import { z } from 'zod';

// Blank counts as unset, so `KEY=` in a .env file doesn't fail the boot.
export const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    schema.optional(),
  );
