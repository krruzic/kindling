# BRAWL image, from @kindling/server's template: the static build and the relay in one node process on one port.
# Build from the repository root (the game uses the workspace's @kindling/* packages):
#   docker build -f examples/brawl/Dockerfile -t brawl:latest .
#   docker run --rm -p 8080:8080 brawl:latest
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Typecheck, then the Vite build into examples/brawl/release.
ARG BUILD_CMD="pnpm -C examples/brawl typecheck && pnpm -C examples/brawl build"
RUN sh -c "$BUILD_CMD"
# Precompress last, after every file is in place (the server ignores .br/.gz older than their file).
ARG PRECOMPRESS="node --experimental-transform-types --no-warnings packages/server/src/bin/precompress.ts examples/brawl/release"
RUN sh -c "$PRECOMPRESS"
# Drop dev dependencies from the runtime image.
RUN CI=true pnpm install --frozen-lockfile --prod

FROM ${NODE_IMAGE}
WORKDIR /app
ARG SERVER_ENTRY=examples/brawl/tools/server.ts
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/examples/brawl/release \
    SERVER_ENTRY=${SERVER_ENTRY}
COPY --from=build /app /app
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" > /dev/null || exit 1
CMD ["sh", "-c", "exec node --experimental-transform-types --no-warnings \"$SERVER_ENTRY\""]
