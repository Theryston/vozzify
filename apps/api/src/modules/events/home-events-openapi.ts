import type { OpenAPIObject } from '@nestjs/swagger';

const homeEventAttributionFields = [
  'eventId',
  'visitId',
  'locale',
  'audience',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Keeps optional attribution fields alongside the Home event union. JSON
 * Schema permits these extra properties while preserving stable variants for
 * API compatibility tools that compare inline unions.
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
    const branchProperties = variant.properties;
    if (!isRecord(branchProperties)) return variant;
    const retainedProperties = { ...branchProperties };
    for (const field of homeEventAttributionFields) {
      delete retainedProperties[field];
    }
    return { ...variant, properties: retainedProperties };
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
 * Hoists the metadata Zod places on every variant out to the containing event
 * item, keeping the published API document backwards compatible.
 */
export const cleanupHomeEventsOpenApiDoc = (
  document: OpenAPIObject,
): OpenAPIObject => {
  const schemas = document.components?.schemas;
  const bodySchema = schemas?.RecordEventsBodyDto;
  if (!isRecord(bodySchema)) return document;

  return {
    ...document,
    components: {
      ...document.components,
      schemas: {
        ...schemas,
        RecordEventsBodyDto: hoistHomeEventAttribution(bodySchema),
      },
    },
  };
};
