import { z } from 'zod';

export const legacyCatalogEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  ytId: z.string(),
});

export type LegacyCatalogEntity = z.infer<typeof legacyCatalogEntitySchema>;
