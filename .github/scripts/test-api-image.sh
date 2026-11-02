#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE:?Set IMAGE to the API runtime image to test}"
prefix="vozzify-api-smoke-$$"
test_dir=$(mktemp -d)
postgres="$prefix-postgres"
redis="$prefix-redis"
api="$prefix-api"

cleanup() {
  status=$?
  if [[ "$status" != 0 ]]; then docker logs "$api" 2>/dev/null || true; fi
  docker rm -fv "$api" "$postgres" "$redis" >/dev/null 2>&1 || true
  docker network rm "$prefix" >/dev/null 2>&1 || true
  rm -rf -- "$test_dir"
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
cat > "$test_dir/env" <<'ENV'
NODE_ENV=production
PORT=3333
DATABASE_URL=postgres://smoke:smoke@postgres:5432/smoke
REDIS_URL=redis://redis:6379
BETTER_AUTH_SECRET=smoke-only-better-auth-secret-not-for-production
REVALIDATE_SECRET=smoke-only-revalidate-secret-not-for-production
RESEND_API_KEY=smoke-only-resend
RAPIDAPI_API_KEY=smoke-only-rapidapi
RUNPOD_API_KEY=smoke-only-runpod
RUNPOD_ENDPOINT_ID=smoke-only-endpoint
ELEVENLABS_API_KEY=smoke-only-elevenlabs
MUSIC_CATALOG_URL=ws://127.0.0.1:3334
MUSIC_CATALOG_API_KEY=smoke-only-music-catalog-key-not-for-production
S3_REGION=us-east-1
S3_BUCKET=smoke
S3_ACCESS_KEY_ID=smoke-only-access-key
S3_SECRET_ACCESS_KEY=smoke-only-secret-key
S3_PUBLIC_URL=https://assets.invalid
ENV

docker run --rm "$IMAGE" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { execFileSync } from "node:child_process";
  import sharp from "sharp";
  assert.notEqual(process.getuid(), 0);
  assert.match(execFileSync("ffmpeg", ["-version"]).toString(), /ffmpeg version/);
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "red" },
  }).png().toBuffer();
  assert.equal((await sharp(png).metadata()).format, "png");
  assert.throws(() => import.meta.resolve("@nestjs/cli"));
'

docker network create --internal "$prefix" >/dev/null
docker run -d --name "$postgres" --network "$prefix" --network-alias postgres \
  --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=smoke \
  --health-cmd 'pg_isready -U smoke -d smoke' \
  --health-interval=1s --health-timeout=5s --health-retries=30 \
  postgres:17-alpine >/dev/null
docker run -d --name "$redis" --network "$prefix" --network-alias redis \
  --tmpfs /data --health-cmd 'redis-cli ping' \
  --health-interval=1s --health-timeout=5s --health-retries=30 \
  redis:8-alpine redis-server --save '' --appendonly no >/dev/null
wait_healthy "$postgres"
wait_healthy "$redis"

# A deploy step must work from the runtime image and be safe to rerun.
for ((run = 0; run < 2; run++)); do
  docker run --rm --network "$prefix" --env-file "$test_dir/env" \
    "$IMAGE" node dist/database/migrate.js
done
docker exec "$postgres" psql -U smoke -d smoke -tAc \
  'SELECT count(*) > 0 FROM drizzle.__drizzle_migrations' | grep -Fxq t

docker run -d --name "$api" --network "$prefix" --env-file "$test_dir/env" \
  --health-interval=1s --health-start-period=5s "$IMAGE" >/dev/null
wait_healthy "$api"
docker exec "$api" node --input-type=module -e '
  import assert from "node:assert/strict";
  const response = await fetch("http://127.0.0.1:3333/v1/health/ready", {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok", checks: { database: "ok", redis: "ok" },
  });
'
echo 'API image smoke tests passed.'
