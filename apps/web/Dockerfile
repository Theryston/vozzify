# syntax=docker/dockerfile:1
# Build from the repository root, keeping workspace symlinks intact.
ARG NODE_IMAGE=node:26-bookworm-slim

FROM ${NODE_IMAGE} AS nub
ARG NUB_VERSION=0.9.5
# npm only bootstraps nub; workspace dependencies use the committed nub lock.
RUN npm install --global "@nubjs/nub@${NUB_VERSION}" && nub --version
WORKDIR /app

FROM nub AS app-deps
COPY --parents package.json nub.lock apps/*/package.json packages/*/package.json ./
RUN nub install --frozen-lockfile --prod --ignore-scripts --filter 'web...'

FROM nub AS app-build
COPY --parents package.json nub.lock apps/*/package.json packages/*/package.json ./
RUN nub install --frozen-lockfile --ignore-scripts --filter 'web...'
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web
# Public values are baked into browser chunks and prerendered metadata.
ARG NEXT_PUBLIC_API_URL=https://api.vozzify.com
ARG NEXT_PUBLIC_SITE_URL=https://vozzify.com
ARG NEXT_PUBLIC_GTM_ENABLED=false
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_GTM_ENABLED=${NEXT_PUBLIC_GTM_ENABLED}
ENV NEXT_TELEMETRY_DISABLED=1
RUN nub --cwd packages/contracts run build && nub --cwd apps/web run build \
    && rm -rf apps/web/.next/cache

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/web
COPY --from=app-deps /app/node_modules /app/node_modules
COPY --from=app-deps /app/packages/contracts/node_modules /app/packages/contracts/node_modules
COPY --from=app-deps /app/apps/web/node_modules ./node_modules
COPY --from=app-build /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=app-build /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=app-build /app/tsconfig.base.json /app/tsconfig.base.json
COPY --from=app-build /app/apps/web/package.json /app/apps/web/next.config.ts /app/apps/web/tsconfig.json ./
# Native cache-handler imports are not bundled by Next's file tracing.
COPY --from=app-build /app/apps/web/cache-handlers ./cache-handlers
COPY --from=app-build /app/apps/web/lib/env/parse-env.ts ./lib/env/parse-env.ts
COPY --from=app-build /app/apps/web/public ./public
# Next writes regenerated pages and optimized images here as the node user.
COPY --from=app-build --chown=node:node /app/apps/web/.next ./.next
# Keep startup validation and runtime config aligned with the baked values.
ARG NEXT_PUBLIC_API_URL=https://api.vozzify.com
ARG NEXT_PUBLIC_SITE_URL=https://vozzify.com
ARG NEXT_PUBLIC_GTM_ENABLED=false
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_GTM_ENABLED=${NEXT_PUBLIC_GTM_ENABLED}
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/robots.txt', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
