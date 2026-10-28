<?php

namespace App\Providers;

use App\Support\JwtVerifier;
use App\Support\Permissions;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
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
