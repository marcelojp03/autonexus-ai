# Build from the repository root; the integrated deployment uses infra/local/docker/web.Dockerfile.
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS build
RUN npm install --global pnpm@12.6.0
WORKDIR /app/web/mf-intelligence
COPY web/mf-intelligence/package.json web/mf-intelligence/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY contracts/auth /app/contracts/auth
COPY web/browser-auth /app/web/browser-auth
COPY web/mf-intelligence/vite.config.js web/mf-intelligence/index.html ./
COPY web/mf-intelligence/src ./src
RUN pnpm run build && pnpm run build:integrated

FROM scratch AS integrated-artifacts
COPY --from=build /app/web/mf-intelligence/dist/integrated/ /mfs/intelligence/

FROM nginx:1.30.6-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949 AS runtime
COPY --from=build /app/web/mf-intelligence/dist/standalone/ /usr/share/nginx/html/
COPY --chmod=0555 infra/local/service-entrypoint.sh /usr/local/bin/service-entrypoint
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/service-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]
