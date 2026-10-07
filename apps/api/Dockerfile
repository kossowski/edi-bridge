# syntax=docker/dockerfile:1

FROM node:24.21.0-alpine3.24 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@12.8.1
WORKDIR /app

FROM base AS prepare
RUN npm install --global turbo@2.11.7
COPY . .
RUN turbo prune @edi-bridge/api --docker

FROM base AS builder
ENV HUSKY=0
COPY --from=prepare /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
RUN pnpm turbo run build --filter=@edi-bridge/api
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store mkdir -p /deploy && pnpm deploy --filter=@edi-bridge/api --prod --legacy /deploy/api

FROM node:24.21.0-alpine3.24 AS runner
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
