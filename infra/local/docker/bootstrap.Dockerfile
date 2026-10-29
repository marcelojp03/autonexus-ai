FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS dependencies
RUN npm install --global pnpm@12.6.0
WORKDIR /app/services/employees
COPY services/employees/package.json services/employees/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752
WORKDIR /app
COPY --from=dependencies /app/services/employees/node_modules /app/node_modules
COPY infra/local /app/infra/local
COPY infra/keycloak/realm.json /app/infra/keycloak/realm.json
COPY infra/keycloak/scripts/cu15-identity.mjs /app/infra/keycloak/scripts/cu15-identity.mjs
COPY infra/rabbitmq/scripts/topology.mjs /app/infra/rabbitmq/scripts/topology.mjs
ENTRYPOINT ["node", "/app/infra/local/bootstrap.mjs"]
CMD ["init"]
