<?php

namespace App\Http\Middleware;

use App\Support\JwtVerifier;
use App\Support\Permissions;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Bearer-only authentication plus per-operation permissions taken from the CU02 catalog.
 * A resolution failure denies access instead of authorizing.
 */
final class AuthenticateFinance
{
    public function __construct(
        private readonly JwtVerifier $verifier,
        private readonly Permissions $permissions,
    ) {
    }

    public function handle(Request $request, Closure $next, string $required): Response
    {
        $authorization = (string) $request->headers->get('Authorization', '');
        if (!preg_match('/^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i', $authorization, $matches)) {
            return response()->json(['error' => 'unauthorized'], 401);
        }
        try {
            $identity = $this->verifier->verify($matches[1]);
        } catch (\Throwable) {
            return response()->json(['error' => 'unauthorized'], 401);
        }
        $granted = $this->permissions->for($matches[1], $identity['sub'], $identity['roles']);
        foreach (explode('|', $required) as $permission) {
            $permission = str_replace('.', ':', $permission);
            if (!in_array($permission, $granted, true)) {
                return response()->json(['error' => 'forbidden'], 403);
            }
        }
        $request->attributes->set('subject', $identity['sub']);
        $request->attributes->set('permissions', $granted);
        return $next($request);
    }
}
