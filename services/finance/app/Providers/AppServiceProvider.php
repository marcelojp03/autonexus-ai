<?php

namespace App\Providers;

use App\Support\JwtVerifier;
use App\Support\Permissions;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(\App\Application\Cu15\EventPublisher::class, \App\Infrastructure\Cu15\AmqpEventPublisher::class);
        $this->app->bind(\App\Application\Cu15\QuoteLinkStore::class, \App\Infrastructure\Cu15\SqlQuoteLinkStore::class);
        $this->app->singleton(JwtVerifier::class, fn () => new JwtVerifier(
            (string) config('finance.issuer'),
            (string) config('finance.audience'),
        ));
        $this->app->singleton(Permissions::class, fn () => new Permissions((string) config('finance.employees_url')));
    }

    public function boot(): void
    {
        //
    }
}
