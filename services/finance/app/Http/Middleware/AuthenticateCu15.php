<?php

namespace App\Http\Middleware;

use App\Application\Cu15\QuoteLinks;
use App\Support\JwtVerifier;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class AuthenticateCu15
{
    public function __construct(private readonly JwtVerifier $verifier) {}

    public function handle(Request $request, Closure $next, string $scope): Response
    {
        $token = $request->bearerToken();
        if ($token === null) {
            abort(401, 'UNAUTHORIZED');
        }
        try {
            $identity = $this->verifier->verify($token);
        } catch (\Throwable) {
            abort(401, 'UNAUTHORIZED');
        }
        if (($identity['azp'] ?? null) !== QuoteLinks::CLIENT || !in_array('cu15.finance.'.$scope, $identity['scopes'] ?? [], true)) {
            abort(403, 'FORBIDDEN');
        }
        return $next($request);
    }
}
