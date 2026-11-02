const weakTagValue = (tag: string): string => tag.trim().replace(/^W\//, '');

const tagMatches = (value: string, etag: string): boolean =>
  value.trim() === '*' ||
  value.split(',').some((tag) => weakTagValue(tag) === weakTagValue(etag));

const strongTagMatches = (value: string, etag: string): boolean =>
  !etag.startsWith('W/') &&
  value
    .split(',')
    .some((tag) => !tag.trim().startsWith('W/') && tag.trim() === etag);

export const conditionalStatus = (
  request: Request,
  response: Response,
): number | undefined => {
  const etag = response.headers.get('ETag') ?? '';
  const modified = Date.parse(response.headers.get('Last-Modified') ?? '');
  const ifMatch = request.headers.get('If-Match');
  if (ifMatch && ifMatch.trim() !== '*' && !strongTagMatches(ifMatch, etag))
    return 412;
  const unmodified = request.headers.get('If-Unmodified-Since');
  if (!ifMatch && unmodified && modified > Date.parse(unmodified) + 999)
    return 412;
  const ifNone = request.headers.get('If-None-Match');
  if (ifNone && tagMatches(ifNone, etag)) return 304;
  const since = request.headers.get('If-Modified-Since');
  if (!ifNone && since && modified <= Date.parse(since) + 999) return 304;
  return undefined;
};
