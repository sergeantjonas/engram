# Built from the repo root, not from here: pnpm resolves a workspace from
# where pnpm-workspace.yaml is, and a context rooted at apps/api cannot see
# packages/shared at all.
#
#   docker build -f apps/api/Dockerfile .
#
# bookworm-slim rather than alpine. Nothing here needs glibc — every runtime
# dependency is pure JavaScript — but the other tenant on the box is already
# on this base, so sharing it costs nothing and avoids musl being a variable
# nobody is testing.
FROM node:24-bookworm-slim AS build
WORKDIR /repo
ENV PNPM_HOME=/pnpm CI=1
RUN corepack enable

# Manifests before source, so the install layer survives every change that is
# only code. All of them, even though only the API is being built: pnpm checks
# the lockfile against the whole workspace before it installs a part of it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
  pnpm install --frozen-lockfile --filter @engram/api... --store-dir /pnpm-store

COPY tsconfig.test.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# `tsc -b` walks the project references, so this builds shared as well as the
# API. Both have to be compiled before the deploy below: pnpm copies what is
# on disk and would otherwise ship a package with no dist in it.
RUN pnpm --filter @engram/api... run build

# A self-contained tree with the workspace link resolved into a real directory
# and the dev dependencies gone. Nothing here is generated at install time, so
# there is no reason to carry the whole store into the runtime image.
RUN pnpm deploy --filter @engram/api --prod --legacy /out

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out /app

# Migrations run on boot rather than as a deploy step, so a container that
# starts is a container whose schema matches its code. Drizzle's migrations
# are generated SQL and forward-only; rolling an image back past a
# destructive one needs the backup, not a tag change.
COPY --chmod=0755 <<'ENTRYPOINT' /app/entrypoint.sh
#!/bin/sh
set -e
node dist/db/migrate.js
exec node dist/server.js
ENTRYPOINT

USER node

# The image carries its own check so compose does not have to describe it
# twice. `/health` answers without touching Postgres — `/ready` is the one
# that does, and a database blip should not restart a healthy API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2012)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
