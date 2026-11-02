#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE:?Set IMAGE to the web runtime image to test}"
prefix="vozzify-web-smoke-$$"
redis="$prefix-redis"
web="$prefix-web"
secret='smoke-only-web-revalidation-secret-not-for-production'

cleanup() {
  status=$?
  if [[ "$status" != 0 ]]; then docker logs "$web" 2>/dev/null || true; fi
  docker rm -fv "$web" "$redis" >/dev/null 2>&1 || true
  docker network rm "$prefix" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_healthy() {
  for ((attempt = 0; attempt < 60; attempt++)); do
    state=$(docker inspect --format '{{.State.Health.Status}}' "$1")
    if [[ "$state" == healthy ]]; then return; fi
    if [[ "$state" == unhealthy ]]; then break; fi
    sleep 1
  done
  docker logs "$1"
  echo "Container $1 did not become healthy." >&2
  return 1
}

# No production credentials, host ports, persistent volumes or external calls.
docker network create --internal "$prefix" >/dev/null
docker run -d --name "$redis" --network "$prefix" --network-alias redis \
  --tmpfs /data --health-cmd 'redis-cli ping' \
  --health-interval=1s --health-timeout=5s --health-retries=30 \
  redis:8-alpine redis-server --save '' --appendonly no \
  --maxmemory-policy volatile-lru >/dev/null
wait_healthy "$redis"

docker run -d --name "$web" --network "$prefix" \
  -e API_URL=http://api-unavailable.invalid:3333 \
  -e REVALIDATE_SECRET="$secret" -e CACHE_REDIS_URL=redis://redis:6379 \
  --health-interval=1s --health-start-period=5s "$IMAGE" >/dev/null
wait_healthy "$web"

docker exec -i "$web" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

assert.notEqual(process.getuid(), 0);
assert.throws(() => import.meta.resolve('vitest'));
const png = await sharp({
  create: { width: 1, height: 1, channels: 3, background: 'red' },
}).png().toBuffer();
assert.equal((await sharp(png).metadata()).format, 'png');

const origin = 'http://127.0.0.1:3000';
const request = (path, options) => fetch(origin + path, {
  signal: AbortSignal.timeout(10000), ...options,
});
const redirect = await request('/', { redirect: 'manual',
  headers: { 'Accept-Language': 'pt-BR' },
});
assert.equal(redirect.status, 307);
assert.equal(new URL(redirect.headers.get('location'), origin).pathname, '/pt-BR');

const terms = await request('/en/terms');
assert.equal(terms.status, 200);
const html = await terms.text();
assert.ok(html.includes('https://vozzify.com/en/terms'));
const staticPath = html.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js)"/)?.[1];
assert.ok(staticPath, 'Rendered pages must reference shipped browser chunks');
assert.equal((await request(staticPath)).status, 200);
for (const path of ['/models/crepe-tiny.onnx', '/ort/ort-wasm-simd-threaded.wasm']) {
  const asset = await request(path);
  assert.equal(asset.status, 200);
  assert.ok((await asset.arrayBuffer()).byteLength > 100000);
}

let publicApiFound = false;
for (const file of await readdir('.next/static', { recursive: true })) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile(join('.next/static', file), 'utf8');
  if (source.includes('https://api.vozzify.com')) publicApiFound = true;
}
assert.ok(publicApiFound, 'Browser chunks must use the production API URL');
assert.ok(!html.includes(process.env.REVALIDATE_SECRET));

const denied = await request('/api/revalidate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tags: ['smoke:image'] }),
});
assert.equal(denied.status, 401);
JS

# Separate processes must read the same entry: a local fallback cannot pass.
cache_probe() {
  docker exec -i -e PROBE_MODE="$1" "$web" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import cache from './cache-handlers/redis.ts';

// The handler connects in the background; allow its initial connection.
await setTimeout(500);
if (process.env.PROBE_MODE === 'write') {
  await cache.set('image-smoke', Promise.resolve({
    value: new Response('shared-cache-value').body,
    tags: ['smoke:image'], timestamp: Date.now(),
    stale: 300, revalidate: 900, expire: 3600,
  }));
} else {
  await cache.refreshTags();
  const entry = await cache.get('image-smoke', []);
  assert.ok(entry, 'A separate process must read the Redis entry');
  assert.equal(await new Response(entry.value).text(), 'shared-cache-value');
  assert.equal(entry.revalidate, process.env.PROBE_MODE === 'stale' ? -1 : 900);
}
process.exit(0);
JS
}
cache_probe write
cache_probe read

docker exec -i "$web" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
const response = await fetch('http://127.0.0.1:3000/api/revalidate', {
  method: 'POST', signal: AbortSignal.timeout(10000),
  headers: { 'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.REVALIDATE_SECRET}` },
  body: JSON.stringify({ tags: ['smoke:image'] }),
});
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { revalidated: ['smoke:image'] });
JS
cache_probe stale
echo 'Web image smoke tests passed.'
