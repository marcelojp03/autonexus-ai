FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS dependencies
RUN npm install --global pnpm@12.6.0
WORKDIR /app/integration/bff
COPY integration/bff/package.json integration/bff/pnpm-lock.yaml ./

FROM dependencies AS production-dependencies
RUN pnpm install --prod --frozen-lockfile

FROM dependencies AS build
RUN pnpm install --frozen-lockfile
COPY integration/bff/nest-cli.json integration/bff/tsconfig.json integration/bff/tsconfig.build.json ./
COPY integration/bff/src ./src
RUN pnpm run build

FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS runtime
ENV NODE_ENV=production
WORKDIR /app/integration/bff
COPY --from=production-dependencies --chown=node:node /app/integration/bff/node_modules ./node_modules
COPY --from=build --chown=node:node /app/integration/bff/dist ./dist
COPY --chown=node:node integration/bff/package.json ./package.json
COPY --chown=node:node contracts/graphql /app/contracts/graphql
COPY --chmod=0555 infra/local/service-entrypoint.sh /usr/local/bin/service-entrypoint
USER node
EXPOSE 3004
ENTRYPOINT ["/usr/local/bin/service-entrypoint"]
CMD ["node", "dist/main.js"]
