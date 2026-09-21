# Built from the repo root, for the same reason the API is:
#
#   docker build -f apps/web/Dockerfile .
FROM node:24-bookworm-slim AS build
WORKDIR /repo
ENV PNPM_HOME=/pnpm CI=1
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
  pnpm install --frozen-lockfile --filter @engram/web... --store-dir /pnpm-store

COPY tsconfig.test.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# Baked into the bundle, which is why DNS has to be settled before this image
# is built rather than before it is deployed: the origin the SPA calls is a
# string in the JavaScript, not something it reads at runtime. It is public by
# the time anyone can view source, so it is a build argument rather than a
# secret — a credential here would sit in `docker history` on a public image.
ARG VITE_API_ORIGIN
RUN test -n "$VITE_API_ORIGIN" || (echo "VITE_API_ORIGIN is required" && exit 1)
ENV VITE_API_ORIGIN=$VITE_API_ORIGIN

RUN pnpm --filter @engram/shared run build \
  && pnpm --filter @engram/web run build

# nginx rather than a node process: this is a static bundle, and the host's
# nginx in front of it is doing the TLS and the routing either way.
FROM nginx:1.29-alpine AS runtime

# Every path that is not a file is the SPA's entry point, or a reload on
# /titles/<id> is a 404 from a server that has never heard of the route.
# Hashed assets are immutable by construction; index.html must not be, or a
# deploy leaves browsers holding the previous build's script tags.
COPY <<'CONF' /etc/nginx/conf.d/default.conf
server {
    listen 2011;
    root /usr/share/nginx/html;

    location /healthz { access_log off; return 200 "ok\n"; }

    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }
}
CONF

COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 2011
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:2011/healthz >/dev/null || exit 1
