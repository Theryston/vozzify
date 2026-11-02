import type { AssetProvider } from './provider.js';

type ByteRange = { start: number; end: number };

type AssetMetadata = {
  etag: string;
  uploaded: Date;
  size: number;
  headers: Headers;
};

const parseRange = (header: string, size: number): ByteRange | null => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  const first = match?.[1];
  const last = match?.[2];
  if (first === undefined || last === undefined || (!first && !last))
    return null;
  if (!first) {
    const suffixLength = Number(last);
    if (
      !Number.isSafeInteger(suffixLength) ||
      suffixLength <= 0 ||
      size === 0
    ) {
      return null;
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(first);
  const requestedEnd = last ? Number(last) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start >= size ||
    start > requestedEnd
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
};

const metadataHeaders = (object: R2Object): Headers => {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Last-Modified', object.uploaded.toUTCString());
  headers.set('Content-Length', String(object.size));
  headers.set('Accept-Ranges', 'bytes');
  return headers;
};

const metadataFor = (object: R2Object): AssetMetadata => ({
  etag: object.httpEtag,
  uploaded: object.uploaded,
  size: object.size,
  headers: metadataHeaders(object),
});

const tags = (header: string): string[] =>
  header.split(',').map((tag) => tag.trim());

const weakTagValue = (tag: string): string =>
  tag.startsWith('W/') ? tag.slice(2) : tag;

const ifMatchPasses = (header: string, etag: string): boolean =>
  header.trim() === '*' || tags(header).includes(etag);

const ifNoneMatchPasses = (header: string, etag: string): boolean =>
  header.trim() === '*' ||
  tags(header).some((candidate) => weakTagValue(candidate) === etag);

const conditionalStatus = (
  request: Request,
  { etag, uploaded }: AssetMetadata,
): number | undefined => {
  const ifMatch = request.headers.get('If-Match');
  if (ifMatch && !ifMatchPasses(ifMatch, etag)) return 412;

  const unmodifiedSince = request.headers.get('If-Unmodified-Since');
  if (
    !ifMatch &&
    unmodifiedSince &&
    uploaded.getTime() > Date.parse(unmodifiedSince) + 999
  ) {
    return 412;
  }

  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch && ifNoneMatchPasses(ifNoneMatch, etag)) return 304;

  const modifiedSince = request.headers.get('If-Modified-Since');
  if (
    !ifNoneMatch &&
    modifiedSince &&
    uploaded.getTime() <= Date.parse(modifiedSince) + 999
  ) {
    return 304;
  }
  return undefined;
};

const ifRangeMatches = (
  request: Request,
  { etag, uploaded }: AssetMetadata,
): boolean => {
  const value = request.headers.get('If-Range');
  if (value === null) return true;
  if (value.startsWith('W/')) return false;
  if (value.startsWith('"')) return value === etag;
  const date = Date.parse(value);
  return (
    Number.isFinite(date) &&
    Math.floor(uploaded.getTime() / 1000) <= date / 1000
  );
};

const conditionalResponse = (
  request: Request,
  metadata: AssetMetadata,
): Response => {
  const status = conditionalStatus(request, metadata) ?? 412;
  if (status === 412) metadata.headers.delete('Content-Length');
  return new Response(null, { status, headers: metadata.headers });
};

const headResponse = async (
  bucket: R2Bucket,
  request: Request,
  key: string,
): Promise<Response> => {
  const object = await bucket.head(key);
  if (!object) return new Response(null, { status: 404 });
  const metadata = metadataFor(object);
  const status = conditionalStatus(request, metadata);
  if (status === 412) metadata.headers.delete('Content-Length');
  return new Response(null, {
    status: status ?? 200,
    headers: metadata.headers,
  });
};

const bodylessGetResponse = (request: Request, object: R2Object): Response => {
  const metadata = metadataFor(object);
  return conditionalResponse(request, metadata);
};

const rangeGetResponse = async (
  bucket: R2Bucket,
  request: Request,
  key: string,
  range: ByteRange,
): Promise<Response> => {
  const object = await bucket.get(key, {
    onlyIf: request.headers,
    range: { offset: range.start, length: range.end - range.start + 1 },
  });
  if (!object) return new Response(null, { status: 404 });
  if (!('body' in object)) return bodylessGetResponse(request, object);

  const responseMetadata = metadataFor(object);
  if (!ifRangeMatches(request, responseMetadata)) {
    return fullGetResponse(bucket, request, key);
  }
  const start = range.start;
  const length = Math.min(range.end - start + 1, object.size - start);
  if (start >= object.size || length <= 0) {
    responseMetadata.headers.set('Content-Range', `bytes */${object.size}`);
    responseMetadata.headers.delete('Content-Length');
    return new Response(null, {
      status: 416,
      headers: responseMetadata.headers,
    });
  }
  const end = start + length - 1;
  responseMetadata.headers.set(
    'Content-Range',
    `bytes ${start}-${end}/${object.size}`,
  );
  responseMetadata.headers.set('Content-Length', String(length));
  return new Response(object.body, {
    status: 206,
    headers: responseMetadata.headers,
  });
};

const fullGetResponse = async (
  bucket: R2Bucket,
  request: Request,
  key: string,
): Promise<Response> => {
  const object = await bucket.get(key, { onlyIf: request.headers });
  if (!object) return new Response(null, { status: 404 });
  if (!('body' in object)) return bodylessGetResponse(request, object);

  const metadata = metadataFor(object);
  const status = conditionalStatus(request, metadata);
  if (status !== undefined) {
    const headers = metadata.headers;
    if (status === 412) headers.delete('Content-Length');
    return new Response(null, { status, headers });
  }
  return new Response(object.body, { status: 200, headers: metadata.headers });
};

const getResponse = async (
  bucket: R2Bucket,
  request: Request,
  key: string,
): Promise<Response> => {
  const rangeRequest = request.headers.get('Range');
  if (rangeRequest === null) return fullGetResponse(bucket, request, key);

  const head = await bucket.head(key);
  if (!head) return new Response(null, { status: 404 });
  const metadata = metadataFor(head);
  const status = conditionalStatus(request, metadata);
  if (status !== undefined) return conditionalResponse(request, metadata);
  if (!ifRangeMatches(request, metadata)) {
    return fullGetResponse(bucket, request, key);
  }
  const range = parseRange(rangeRequest, head.size);
  if (!range) {
    metadata.headers.set('Content-Range', `bytes */${head.size}`);
    metadata.headers.delete('Content-Length');
    return new Response(null, { status: 416, headers: metadata.headers });
  }
  return rangeGetResponse(bucket, request, key, range);
};

export const createR2Provider = (bucket: R2Bucket): AssetProvider => ({
  freshnessSeconds: 10_800,
  cacheMode: 'stale-while-revalidate',
  resolve({ request, key }) {
    return request.method === 'HEAD'
      ? headResponse(bucket, request, key)
      : getResponse(bucket, request, key);
  },
});
