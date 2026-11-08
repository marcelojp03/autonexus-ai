<?php

namespace App\Providers;

use App\Support\JwtVerifier;
use App\Support\Permissions;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(\App\Application\Ledger\DocumentStorage::class, \App\Infrastructure\Ledger\S3DocumentStorage::class);
        $this->app->bind(\App\Application\Ledger\DocumentRepository::class, \App\Infrastructure\Ledger\SqlDocumentRepository::class);
        $this->app->bind(\App\Application\Ledger\LedgerStore::class, \App\Infrastructure\Ledger\SqlLedgerStore::class);
        $this->app->bind(\App\Application\Ledger\CollectionContext::class, \App\Infrastructure\Ledger\HttpCollectionContext::class);
        $this->app->bind(\App\Application\Cu15\EventPublisher::class, \App\Infrastructure\Cu15\AmqpEventPublisher::class);
        $this->app->bind(\App\Application\Cu15\QuoteLinkStore::class, \App\Infrastructure\Cu15\SqlQuoteLinkStore::class);
        $this->app->singleton(JwtVerifier::class, fn () => new JwtVerifier(
            (string) config('finance.issuer'),
            (string) config('finance.audience'),
            jwksUri: (string) config('finance.jwks_uri'),
        ));
        $this->app->singleton(Permissions::class, fn () => new Permissions((string) config('finance.employees_url')));
    }

    public function boot(): void
    {
        //
    }
}
