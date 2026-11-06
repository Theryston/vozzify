import type { OpenAPIObject } from '@nestjs/swagger';
import { getRegisteredZodDtos, toOpenApiSchema } from './create-zod-dto.js';

const homeEventAttributionFields = [
  'eventId',
  'visitId',
  'locale',
  'audience',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Hoists optional common fields beside the event union. JSON Schema allows
 * these extra properties on each branch, while keeping the variant schemas
 * stable for API compatibility tools that cannot match changed inline unions.
 */
const hoistHomeEventAttribution = (schema: Record<string, unknown>) => {
  const properties = schema.properties;
  if (!isRecord(properties) || !isRecord(properties.events)) return schema;
  const events = properties.events;
  if (!isRecord(events.items)) return schema;
  const items = events.items;
  if (!Array.isArray(items.oneOf) || items.oneOf.length === 0) return schema;

  const variants = items.oneOf;
  const first = variants[0];
  if (!isRecord(first)) return schema;
  const firstProperties = first.properties;
  if (!isRecord(firstProperties)) return schema;
  const attribution = Object.fromEntries(
    homeEventAttributionFields.flatMap((field) => {
      const value = firstProperties[field];
      return value === undefined ? [] : [[field, value]];
    }),
  );
  if (
    Object.keys(attribution).length !== homeEventAttributionFields.length ||
    !variants.every(hasHomeEventAttribution)
  ) {
    return schema;
  }

  const stableVariants = variants.map((variant) => {
    if (!isRecord(variant)) return variant;
    const properties = variant.properties;
    if (!isRecord(properties)) return variant;
    const branchProperties = { ...properties };
    for (const field of homeEventAttributionFields) {
      delete branchProperties[field];
    }
    return { ...variant, properties: branchProperties };
  });

  return {
    ...schema,
    properties: {
      ...properties,
      events: {
        ...events,
        items: {
          ...items,
          properties: attribution,
          oneOf: stableVariants,
        },
      },
    },
  };
};

const hasHomeEventAttribution = (variant: unknown): boolean => {
  if (!isRecord(variant)) return false;
  const properties = variant.properties;
  if (!isRecord(properties)) return false;
  return homeEventAttributionFields.every((field) => field in properties);
};

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
      const schema = toOpenApiSchema(dto.schema);
      replaced[dto.name] =
        dto.name === 'RecordEventsBodyDto' && isRecord(schema)
          ? hoistHomeEventAttribution(schema)
          : schema;
    }
  }
  return {
    ...document,
    components: { ...document.components, schemas: replaced },
  };
};
