# The nightly library walk, run on the Bytesized slot by a systemd user timer.
# It holds the Plex token there and posts the walk to Engram, which is what
# keeps the token off the box the database is on.
#
# Built from the repo root, like the API image: the tools import
# @engram/shared by name, and it is compiled from the workspace.
#
#   docker build -f tools/Dockerfile .
FROM node:24-bookworm-slim AS build
WORKDIR /repo
ENV PNPM_HOME=/pnpm CI=1
RUN corepack enable

# Every manifest, for the reason the API image gives: pnpm checks the lockfile
# against the whole workspace before it installs a part of it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
  pnpm install --frozen-lockfile --filter @engram/shared... --store-dir /pnpm-store

COPY packages/shared packages/shared
RUN pnpm --filter @engram/shared run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Shared has no dependencies of its own, so its manifest and its dist are the
# whole package, and the tools need nothing else from npm. Node finds it by
# walking up from tools/ to this node_modules.
COPY --from=build /repo/packages/shared/package.json node_modules/@engram/shared/
COPY --from=build /repo/packages/shared/dist node_modules/@engram/shared/dist
COPY tools/dump-library.mjs tools/ingest-client.mjs tools/plex-client.mjs tools/

# Without a target the walk is meant for tools/out, which this user cannot
# create, so a run would take the token to plex.tv, walk the whole library,
# and only then die. This image exists to post, so it refuses before anything
# leaves the container.
COPY --chmod=0755 <<'ENTRYPOINT' /app/walk.sh
#!/bin/sh
set -e
: "${ENGRAM_INGEST_URL:?is not set: this image posts the walk, it does not keep it}"
exec node tools/dump-library.mjs
ENTRYPOINT

USER node
ENTRYPOINT ["/app/walk.sh"]
