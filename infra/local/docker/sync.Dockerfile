# MS05 Sincronización. Built from the repository root context.
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS build
RUN npm install --global pnpm@12.6.0
WORKDIR /app
COPY services/sync/package.json services/sync/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY services/sync/tsconfig.json services/sync/tsconfig.build.json services/sync/nest-cli.json ./
COPY services/sync/src ./src
RUN pnpm run build

FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS runtime
ENV NODE_ENV=production
RUN npm install --global pnpm@12.6.0
WORKDIR /app
COPY services/sync/package.json services/sync/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY --chmod=0555 infra/local/service-entrypoint.sh /usr/local/bin/service-entrypoint
EXPOSE 3005
ENTRYPOINT ["/usr/local/bin/service-entrypoint"]
CMD ["node", "dist/main.js"]
