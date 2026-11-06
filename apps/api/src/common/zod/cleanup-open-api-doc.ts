import type { OpenAPIObject } from '@nestjs/swagger';
import { getRegisteredZodDtos, toOpenApiSchema } from './create-zod-dto.js';

/**
 * Replaces the component schemas @nestjs/swagger derived from
 * `createZodDto` classes with the exact JSON Schema of their Zod schema
 * (nested objects, unions, formats, …). Call it on the document returned by
 * `SwaggerModule.createDocument`.
 */
export const cleanupOpenApiDoc = (document: OpenAPIObject): OpenAPIObject => {
  const schemas = document.components?.schemas;
  if (!schemas) {
    return document;
  }
  const replaced = { ...schemas };
  for (const dto of getRegisteredZodDtos()) {
    if (dto.name in replaced) {
      replaced[dto.name] = toOpenApiSchema(dto.schema);
    }
  }
  return {
    ...document,
    components: { ...document.components, schemas: replaced },
  };
};
