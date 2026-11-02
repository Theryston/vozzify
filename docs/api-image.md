# API image publication

`.github/workflows/api-image.yml` builds the API when its code, contracts,
workspace manifests, lockfile, or image pipeline changes. Web-only source
changes do not rebuild it.

Pull requests run API lint, type checks and coverage, build the runtime image,
and test it against temporary PostgreSQL and Redis containers. The smoke test
checks native image processing, ffmpeg, migrations (including a second run),
and HTTP liveness/readiness. It uses fake integration credentials and an
isolated Docker network. It removes its containers, network and temporary files.

A push to `main` runs the same checks, then publishes the tested image to
`ghcr.io/theryston/vozzify/api` with `latest` and `sha-<short-commit>` tags.
Publication uses the workflow's `GITHUB_TOKEN` with `packages: write`.
BuildKit caches layers separately from the other applications.

Only after publication succeeds does the workflow call Coolify, using these
GitHub Actions repository secrets:

- `API_COOLIFY_DEPLOY_URL`: the API stack's authenticated deploy webhook URL.
- `COOLIFY_DEPLOY_TOKEN`: a Coolify API token with deployment permission.

The shared `.github/scripts/deploy-coolify.sh` sends the authenticated POST,
fails on HTTP/network errors, and keeps credentials and responses out of logs.
Pull requests never publish or call Coolify. Production runs are serialized
through the deploy request to keep publication and the `latest` tag ordered.

## Runtime

Build from the repository root:

```sh
docker build -f apps/api/Dockerfile -t vozzify-api:local .
IMAGE=vozzify-api:local bash .github/scripts/test-api-image.sh
```

The image runs as the unprivileged `node` user and includes only production
Node dependencies, the compiled API/contracts, SQL migrations, ffmpeg and CA
certificates. Runtime configuration comes from the environment; no `.env`
files are copied into the image. The default command is `node dist/main.js`.
The migration container uses the same image with
`node dist/database/migrate.js`; migrations never run implicitly at API boot.

The image exposes port `3333` and checks `/v1/health` for liveness. Route
production traffic only once `/v1/health/ready` reports PostgreSQL and Redis
ready. See `apps/api/.env.example` for runtime configuration.

Creating the API stack in Coolify and configuring its runtime credentials
are separate deployment steps. For private GHCR packages, the deployment
server must have registry credentials that can read the package.
