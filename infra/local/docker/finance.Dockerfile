FROM php:8.2-cli-bookworm@sha256:8bfff0e5249f2073504c335b9f7ae54bbe84c3bc9338bfc8d2a04e77d112360b AS extensions
RUN apt-get update \
    && apt-get install --yes --no-install-recommends libpq-dev libonig-dev libxml2-dev libzip-dev libcurl4-openssl-dev \
    && docker-php-ext-install -j2 pdo_pgsql bcmath mbstring sockets dom xml xmlreader xmlwriter zip curl pcntl opcache \
    && rm -rf /var/lib/apt/lists/*

FROM php:8.2-cli-bookworm@sha256:8bfff0e5249f2073504c335b9f7ae54bbe84c3bc9338bfc8d2a04e77d112360b AS runtime-base
RUN apt-get update \
    && apt-get install --yes --no-install-recommends libpq5 libonig5 libxml2 libzip4 libcurl4 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=extensions /usr/local/lib/php/extensions/ /usr/local/lib/php/extensions/
COPY --from=extensions /usr/local/etc/php/conf.d/ /usr/local/etc/php/conf.d/
RUN php -r 'foreach (["pdo_pgsql", "bcmath", "mbstring", "sockets", "dom", "libxml", "curl", "zip", "pcntl"] as $extension) { if (!extension_loaded($extension)) { fwrite(STDERR, "Missing extension: $extension\n"); exit(1); } }'
WORKDIR /app/services/finance

FROM composer:2.8.12@sha256:5248900ab8b5f7f880c2d62180e40960cd87f60149ec9a1abfd62ac72a02577c AS composer

FROM runtime-base AS build
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
RUN apt-get update && apt-get install --yes --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
COPY services/finance/composer.json services/finance/composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --no-scripts --no-plugins --no-autoloader
COPY services/finance/artisan ./artisan
COPY services/finance/app ./app
COPY services/finance/bootstrap/app.php services/finance/bootstrap/providers.php ./bootstrap/
COPY services/finance/config ./config
COPY services/finance/database/migrations ./database/migrations
COPY services/finance/database/factories ./database/factories
COPY services/finance/database/seeders ./database/seeders
COPY services/finance/public/index.php ./public/index.php
COPY services/finance/resources ./resources
COPY services/finance/routes ./routes
RUN mkdir -p bootstrap/cache storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs \
    && composer dump-autoload --no-dev --classmap-authoritative --no-scripts --no-plugins \
    && composer check-platform-reqs --no-dev \
    && php artisan package:discover --ansi

FROM runtime-base AS runtime
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --create-home app
COPY --from=build /app/services/finance /app/services/finance
RUN chown -R app:app storage bootstrap/cache
COPY --chmod=0555 infra/local/service-entrypoint.sh /usr/local/bin/service-entrypoint
USER app
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/service-entrypoint"]
# The framework development server is for this isolated local demo, not production.
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
