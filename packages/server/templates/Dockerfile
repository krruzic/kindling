# Kindling game image (template): the static build and the relay in one node process on one port.
# Copy to your game's root and adjust the ARGs. Assumes a pnpm workspace whose packages are linked (workspace:* or
# link:), so @kindling/* resolve to real paths outside node_modules (node only strips types there).
#   docker build -t mygame:latest .
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Your build: typecheck, vite build into release/, copy the landing page and any extra static files into release/.
ARG BUILD_CMD="pnpm exec tsc --noEmit && pnpm exec vite build --outDir release --emptyOutDir --logLevel warn"
RUN sh -c "$BUILD_CMD"
# Precompress last, after every file is in place (the server ignores .br/.gz older than their file).
ARG PRECOMPRESS="node --experimental-transform-types --no-warnings node_modules/@kindling/server/src/bin/precompress.ts release"
RUN sh -c "$PRECOMPRESS"
# Drop dev dependencies from the runtime image.
RUN CI=true pnpm install --frozen-lockfile --prod

FROM ${NODE_IMAGE}
WORKDIR /app
ARG SERVER_ENTRY=tools/server.ts
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/release \
    SERVER_ENTRY=${SERVER_ENTRY}
COPY --from=build /app /app
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" > /dev/null || exit 1
CMD ["sh", "-c", "exec node --experimental-transform-types --no-warnings \"$SERVER_ENTRY\""]
