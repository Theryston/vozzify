import { StructuredData } from '@/components/structured-data';
import { getSiteUrl } from '@/lib/env/client';

export function HomeStructuredData() {
  const url = new URL('/', getSiteUrl()).href;
  return (
    <StructuredData
      data={{
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        '@id': `${url}#website`,
        name: 'Vozzify',
        url,
      }}
    />
  );
}
