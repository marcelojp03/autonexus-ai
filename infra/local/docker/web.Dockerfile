FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS build
RUN npm install --global pnpm@12.6.0
ENV HUSKY=0 NG_BUILD_MAX_WORKERS=2
WORKDIR /app
COPY contracts/auth /app/contracts/auth
COPY web/browser-auth /app/web/browser-auth
COPY web/integrated-routing.ts /app/web/integrated-routing.ts
COPY web/mf-employees/package.json web/mf-employees/pnpm-lock.yaml web/mf-employees/pnpm-workspace.yaml web/mf-employees/.npmrc /app/web/mf-employees/
COPY web/mf-employees/patches /app/web/mf-employees/patches
RUN pnpm --dir /app/web/mf-employees install --frozen-lockfile
COPY web/mf-employees/angular.json web/mf-employees/tsconfig.json web/mf-employees/tsconfig.app.json /app/web/mf-employees/
COPY web/mf-employees/src /app/web/mf-employees/src
COPY web/mf-employees/public /app/web/mf-employees/public
RUN pnpm --dir /app/web/mf-employees run build:integrated
COPY web/mf-operations/package.json web/mf-operations/pnpm-lock.yaml web/mf-operations/pnpm-workspace.yaml web/mf-operations/.npmrc /app/web/mf-operations/
COPY web/mf-operations/patches /app/web/mf-operations/patches
RUN pnpm --dir /app/web/mf-operations install --frozen-lockfile
COPY web/mf-operations/angular.json web/mf-operations/tsconfig.json web/mf-operations/tsconfig.app.json /app/web/mf-operations/
COPY web/mf-operations/src /app/web/mf-operations/src
COPY web/mf-operations/public /app/web/mf-operations/public
RUN pnpm --dir /app/web/mf-operations run build:integrated
COPY web/mf-finance/package.json web/mf-finance/pnpm-lock.yaml /app/web/mf-finance/
RUN pnpm --dir /app/web/mf-finance install --frozen-lockfile
COPY web/mf-finance/vite.config.js /app/web/mf-finance/vite.config.js
COPY web/mf-finance/src /app/web/mf-finance/src
COPY web/mf-finance/public /app/web/mf-finance/public
RUN pnpm --dir /app/web/mf-finance run build:integrated
COPY web/shell/package.json web/shell/pnpm-lock.yaml /app/web/shell/
RUN pnpm --dir /app/web/shell install --frozen-lockfile
COPY web/shell/tsconfig.json web/shell/vite.config.ts web/shell/index.html /app/web/shell/
COPY web/shell/src /app/web/shell/src
COPY web/shell/public/favicon.svg web/shell/public/runtime-config.js /app/web/shell/public/
COPY web/shell/scripts/stage-mfs.mjs /app/web/shell/scripts/stage-mfs.mjs
WORKDIR /app/web/shell
RUN pnpm run stage:mfs && pnpm run build \
    && test -f dist/index.html \
    && test -f dist/mfs/employees/main.js && test -f dist/mfs/employees/styles.css \
    && test -f dist/mfs/operations/main.js && test -f dist/mfs/operations/styles.css \
    && test -f dist/mfs/finance/main.js

FROM nginx:1.30.6-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949 AS runtime
RUN addgroup -g 1000 app && adduser -D -u 1000 -G app app \
    && chown -R app:app /var/cache/nginx \
    && touch /var/run/nginx.pid && chown app:app /var/run/nginx.pid
COPY --from=build /app/web/shell/dist/ /usr/share/nginx/html/
COPY infra/local/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0555 infra/local/service-entrypoint.sh /usr/local/bin/service-entrypoint
USER app
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/service-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]
