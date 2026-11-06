/** Escape markup even inside JSON: catalog names may contain HTML delimiters. */
export function StructuredData({ data }: { data: Record<string, unknown> }) {
  return (
    <script type="application/ld+json">
      {JSON.stringify(data).replace(/</g, '\\u003c')}
    </script>
  );
}
