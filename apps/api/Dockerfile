# syntax=docker/dockerfile:1
# Build from the repository root. The same image runs the API and the
# explicit deploy step: node dist/database/migrate.js.
ARG NODE_IMAGE=node:26-bookworm-slim

FROM ${NODE_IMAGE} AS nub
# Match devEngines.packageManager in the root package.json.
ARG NUB_VERSION=0.9.5
# npm only bootstraps nub; workspace dependencies use the committed nub lock.
RUN npm install --global "@nubjs/nub@${NUB_VERSION}" && nub --version
WORKDIR /app

FROM nub AS app-deps
# The lockfile includes every workspace, even when installing only the API.
COPY --parents package.json nub.lock apps/*/package.json packages/*/package.json ./
RUN nub install --frozen-lockfile --prod --ignore-scripts --filter 'api...'

FROM nub AS app-build
COPY --parents package.json nub.lock apps/*/package.json packages/*/package.json ./
RUN nub install --frozen-lockfile --ignore-scripts --filter 'api...'
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN nub --cwd packages/contracts run build && nub --cwd apps/api run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV PORT=3333
# Audio processing needs ffmpeg; HTTPS integrations need the system CA bundle.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/apps/api
# Preserve relative workspace symlinks without shipping build dependencies.
COPY --from=app-deps /app/node_modules /app/node_modules
COPY --from=app-deps /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=app-deps /app/apps/api/node_modules ./node_modules
COPY --from=app-build /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=app-build /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=app-build /app/apps/api/package.json ./package.json
COPY --from=app-build /app/apps/api/dist ./dist
COPY --from=app-build /app/apps/api/drizzle ./drizzle
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/v1/health', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
