# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24.21.0-alpine3.24

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
COPY package.json ./
RUN npm install --global "pnpm@$(node -p "require('./package.json').devEngines.packageManager.version")"

FROM base AS prepare
RUN apk add --no-cache curl
# The standalone binary must match the repo's turbo, which package.json pins to an exact version.
RUN set -eu; \
    version="$(node -p "require('./package.json').devDependencies.turbo")"; \
    echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "turbo must be pinned to an exact version, got: $version" >&2; exit 1; }; \
    case "$(uname -m)" in \
      x86_64) target=x86_64-unknown-linux-musl ;; \
      aarch64) target=aarch64-unknown-linux-musl ;; \
      *) echo 'Unsupported architecture' >&2; exit 1 ;; \
    esac; \
    archive="turbo-$version-$target.tar.gz"; \
    release="https://github.com/vercel/turborepo/releases/download/v$version"; \
    cd /tmp; \
    curl -fsSL "$release/SHA256SUMS" -o SHA256SUMS; \
    curl -fsSL "$release/$archive" -o "$archive"; \
    awk -v name="$archive" '$2 == name && NF == 2 { print }' SHA256SUMS > turbo-checksum; \
    [ "$(wc -l < turbo-checksum)" -eq 1 ]; \
    sha256sum -c turbo-checksum; \
    [ "$(tar -tzf "$archive")" = turbo ]; \
    tar -xzf "$archive" -C /usr/local/bin turbo; \
    chmod 755 /usr/local/bin/turbo; \
    rm SHA256SUMS turbo-checksum "$archive"
COPY . .
RUN turbo prune @edi-bridge/api --docker

FROM base AS builder
ENV HUSKY=0
COPY --from=prepare /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
RUN pnpm turbo run build --filter=@edi-bridge/api
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store mkdir -p /deploy && pnpm deploy --filter=@edi-bridge/api --prod --legacy /deploy/api

FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production
ENV API_PORT=3001
WORKDIR /app
COPY --from=builder --chown=node:node /deploy/api/package.json ./
COPY --from=builder --chown=node:node /deploy/api/node_modules ./node_modules
COPY --from=builder --chown=node:node /deploy/api/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.API_PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
