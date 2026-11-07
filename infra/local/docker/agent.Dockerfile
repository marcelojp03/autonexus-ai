# CU25/CU26 assistant and report service. Built from the repository root context.
#
# The service mints no identity: it forwards the caller's bearer token to Operations and never writes a
# token to disk. The report documents live on a named volume (`REPORT_JOBS_DIR`), which is what lets the
# interface read a finished report after the container is recreated.
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS build
RUN npm install --global pnpm@12.6.0
WORKDIR /app
COPY integration/agent/package.json integration/agent/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY integration/agent/tsconfig.json ./
COPY integration/agent/src ./src
RUN pnpm run build

FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS runtime
ENV NODE_ENV=production
RUN npm install --global pnpm@12.6.0
WORKDIR /app
COPY integration/agent/package.json integration/agent/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
# The jobs directory belongs to the runtime user and is the only writable path it needs.
RUN mkdir -p /var/lib/autonexus-agent/jobs && chown -R node:node /var/lib/autonexus-agent
ENV AGENT_PORT=3099 \
    AGENT_HOST=0.0.0.0 \
    REPORT_JOBS_DIR=/var/lib/autonexus-agent/jobs
USER node
EXPOSE 3099
CMD ["node", "dist/server.js"]
