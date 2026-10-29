FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS dependencies
RUN npm install --global pnpm@12.6.0
WORKDIR /app/services/employees
COPY services/employees/package.json services/employees/pnpm-lock.yaml ./

FROM dependencies AS production-dependencies
RUN pnpm install --prod --frozen-lockfile

FROM dependencies AS build
RUN pnpm install --frozen-lockfile
COPY services/employees/nest-cli.json services/employees/tsconfig.json services/employees/tsconfig.build.json ./
COPY services/employees/src ./src
RUN pnpm run build

FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS runtime
ENV NODE_ENV=production
WORKDIR /app/services/employees
COPY --from=production-dependencies --chown=node:node /app/services/employees/node_modules ./node_modules
COPY --from=build --chown=node:node /app/services/employees/dist ./dist
COPY --chown=node:node services/employees/package.json ./package.json
COPY --chmod=0555 infra/local/service-entrypoint.sh /usr/local/bin/service-entrypoint
USER node
EXPOSE 3002
ENTRYPOINT ["/usr/local/bin/service-entrypoint"]
CMD ["node", "dist/main.js"]
