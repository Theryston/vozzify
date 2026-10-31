import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { catalogDatasetSchema } from '@vozzify/contracts';
import { z } from 'zod';

// Long enough that a key can't be guessed, and that the local placeholder in
// .env.example can't pass for a real one by accident.
const API_KEY_MIN_LENGTH = 32;

const parseApiKeys = (value: string): string[] =>
  value
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  // 0 lets the OS pick a free port (used by the e2e tests).
  PORT: z.coerce.number().int().min(0).max(65_535).default(3334),
  // Our own Postgres: the music_catalog schema plus, from the bootstrap
  // ticket on, the MusicBrainz tables mbslave restores next to it.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Comma-separated: any listed key opens the handshake, so a key is rotated
  // by listing the new one next to the old one, then dropping the old one.
  API_KEYS: z
    .string()
    .transform(parseApiKeys)
    .pipe(z.array(z.string().min(API_KEY_MIN_LENGTH)).min(1)),
  // Which MusicBrainz data the first import lays down. No default: forgetting
  // it in production must not silently seed the tiny development catalog.
  CATALOG_DATASET: catalogDatasetSchema,
  // A connection that misses one pong between two pings is dropped, so a
  // dead peer is gone after at most twice this interval.
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  // A request still unanswered after this long gets an INTERNAL error.
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.output<typeof envSchema>;

// Meilisearch is reached over HTTP(S): the dev compose and a private compose
// network use plain HTTP, a managed instance HTTPS.
const meilisearchUrlSchema = z.url({ protocol: /^https?$/ });

// Each process reads only the key it needs: the server can search, nothing
// else, and the worker can write. Both are keys created in Meilisearch (see
// CLAUDE.md "Meilisearch"), scoped to what they do, not its master key.
const serverEnvSchema = envSchema.extend({
  MEILISEARCH_URL: meilisearchUrlSchema,
  MEILISEARCH_SEARCH_API_KEY: z.string().min(1),
  // The parallel database of a running reimport (same server, other
  // database). Only the boot fallback reads it: after a flip that dropped
  // the retired copy, a restarted server opens the new copy instead of the
  // unreachable configured one (see apps/music-catalog/CLAUDE.md).
  REIMPORT_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
});

const workerEnvSchema = envSchema.extend({
  MEILISEARCH_URL: meilisearchUrlSchema,
  MEILISEARCH_WRITE_API_KEY: z.string().min(1),
  // Recordings sent to Meilisearch per task: bigger batches index faster and
  // use more memory, smaller ones checkpoint more often.
  INDEXING_BATCH_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(50_000)
    .default(50_000),
  // The parallel database the blue-green reimport rebuilds the catalog in
  // after MusicBrainz's yearly schema change (same server, other database).
  // Absent, the worker never reimports (see apps/music-catalog/CLAUDE.md).
  REIMPORT_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  // Drop the retired database after the flip, the default path: only an
  // explicit 'false' keeps it for inspection (same CLAUDE.md section).
  REIMPORT_CLEANUP_OLD_COPY: z.enum(['true', 'false']).optional(),
  // A file the worker keeps touching while it runs, which the production
  // container's health check reads (see CLAUDE.md, "Operations"). Absent,
  // nothing is written: local development needs no health check.
  WORKER_HEARTBEAT_FILE: z.string().min(1).optional(),
});

export type ServerEnv = z.output<typeof serverEnvSchema>;
export type WorkerEnv = z.output<typeof workerEnvSchema>;

const parseWith = <TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, string | undefined>,
): z.output<TSchema> => {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
};

type EnvSource = Record<string, string | undefined>;

export const parseEnv = (source: EnvSource): Env =>
  parseWith(envSchema, source);

export const parseServerEnv = (source: EnvSource): ServerEnv =>
  parseWith(serverEnvSchema, source);

export const parseWorkerEnv = (source: EnvSource): WorkerEnv =>
  parseWith(workerEnvSchema, source);

// The restore runs in the mbslave container, not next to the server and the
// worker, so it parses its own small set on top of the shared one: what to
// restore and where the dumps are. It stays a separate schema (not an
// extension the server or worker reads): the shared schema is asserted
// exactly by its specs, and the server and worker must not need the dump
// settings, nor the restore the API keys.
const restoreEnvSchema = envSchema
  .pick({ NODE_ENV: true, DATABASE_URL: true, CATALOG_DATASET: true })
  .extend({
    // The `.../data` directory the full export is published under. Points at
    // a fake HTTP server in tests.
    MUSICBRAINZ_DUMP_BASE_URL: z
      .url({ protocol: /^https?$/ })
      .default('https://data.metabrainz.org/pub/musicbrainz/data'),
    // The MetaBrainz access token replication authenticates with in `full`
    // mode (free for non-commercial use). The mbslave binary reads either
    // variable itself, so both stay optional here; the replication service
    // requires a non-empty one at container startup (`assertReplicationToken`,
    // which also treats the compose file's empty default as missing), which
    // keeps `parseRestoreEnv` (and the restore, which needs no token)
    // exactly as it was.
    MBSLAVE_MUSICBRAINZ_TOKEN: z.string().optional(),
    MBSLAVE_MUSICBRAINZ_TOKEN_FILE: z.string().optional(),
    // The mbslave release running here, baked into the image from its build
    // argument (`mbslave.Dockerfile`). Recorded with a schema-change stall,
    // so the reimport starts once the container runs a newer release than
    // the stalled one. Absent outside the image (local runs, tests).
    MBSLAVE_REF: z.string().min(1).optional(),
    // The parallel database the blue-green reimport restores the new dump
    // into (same server, other database, migrated like the serving one).
    // Absent, the container never reimports.
    REIMPORT_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  });

export type RestoreEnv = z.output<typeof restoreEnvSchema>;

export const parseRestoreEnv = (source: EnvSource): RestoreEnv =>
  parseWith(restoreEnvSchema, source);

// The compose file passes both token variables through with an empty default
// when unset. mbslave would crash opening an empty `_FILE` path, and an
// empty token authenticates nothing, so blank values never reach the binary;
// an absent token still fails, but at the replication service's validation
// or as the mirror's 403, both with a clear message.
export const withoutBlankTokenVars = (source: EnvSource): EnvSource => {
  const cleaned = { ...source };
  for (const name of [
    'MBSLAVE_MUSICBRAINZ_TOKEN',
    'MBSLAVE_MUSICBRAINZ_TOKEN_FILE',
  ] as const) {
    if (cleaned[name]?.trim() === '') {
      delete cleaned[name];
    }
  }
  return cleaned;
};

/** The environment the mbslave binary is spawned with (see above). */
export const mbslaveSpawnEnv = (): NodeJS.ProcessEnv =>
  withoutBlankTokenVars(process.env);

// Resolves to apps/music-catalog/.env from both src/config and dist/config.
const dotEnvPath = fileURLToPath(new URL('../../.env', import.meta.url));

let cachedEnv: Env | undefined;

// Outside production and tests, variables from apps/music-catalog/.env are
// loaded first (without overriding variables that are already set), so no
// dotenv dependency is needed.
const loadDotEnvFile = (): void => {
  const nodeEnv = process.env.NODE_ENV;
  if (
    nodeEnv !== 'production' &&
    nodeEnv !== 'test' &&
    existsSync(dotEnvPath)
  ) {
    process.loadEnvFile(dotEnvPath);
  }
};

/**
 * Parses `process.env` once and caches the result: the settings every
 * process shares (what the migrations need too). The server and the worker
 * load their own, bigger sets with `loadServerEnv` and `loadWorkerEnv`.
 */
export const loadEnv = (): Env => {
  if (cachedEnv) {
    return cachedEnv;
  }
  loadDotEnvFile();
  cachedEnv = parseEnv(process.env);
  return cachedEnv;
};

export const loadServerEnv = (): ServerEnv => {
  loadDotEnvFile();
  return parseServerEnv(process.env);
};

export const loadWorkerEnv = (): WorkerEnv => {
  loadDotEnvFile();
  return parseWorkerEnv(process.env);
};

/**
 * Parses `process.env` for the restore. In the mbslave container the compose
 * file passes the variables with `env_file`, so loading `.env` here stays a
 * local fallback, like for the server and the worker.
 */
export const loadRestoreEnv = (): RestoreEnv => {
  loadDotEnvFile();
  return parseRestoreEnv(process.env);
};
