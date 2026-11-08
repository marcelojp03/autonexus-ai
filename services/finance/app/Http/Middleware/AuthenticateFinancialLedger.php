<?php

namespace App\Http\Middleware;

use App\Support\JwtVerifier;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

final class AuthenticateFinancialLedger
{
    public function __construct(private readonly JwtVerifier $verifier) {}

    public function handle(Request $request, Closure $next, string $required = ''): Response
    {
        $token = $request->bearerToken();
        try {
            $identity = $this->verifier->verify($token ?? '');
        } catch (\Throwable) {
            return $this->error('UNAUTHORIZED', 401);
        }
        if (str_starts_with($identity['azp'] ?? '', 'autonexus-cu15-') || str_starts_with($identity['sub'], 'service-account-')) {
            return $this->error('FORBIDDEN', 403);
        }
        try {
            $response = Http::withToken($token)->acceptJson()->timeout(3)->withoutRedirecting()
                ->get(rtrim(config('finance.employees_url'), '/').'/security/permissions');
        } catch (\Throwable) {
            return $this->error('AUTHORIZATION_UNAVAILABLE', 503);
        }
        if (!$response->successful()) {
            return $this->error($response->status() === 403 ? 'FORBIDDEN' : 'AUTHORIZATION_UNAVAILABLE', $response->status() === 403 ? 403 : 503);
        }
        $data = $response->json();
        if (!is_array($data) || !array_key_exists('employeeId', $data) || !array_key_exists('employeeStatus', $data) || !is_array($data['effective'] ?? null)) {
            return $this->error('AUTHORIZATION_UNAVAILABLE', 503);
        }
        if (!is_string($data['employeeId']) || !Str::isUuid($data['employeeId']) || $data['employeeStatus'] !== 'active') {
            return $this->error('FORBIDDEN', 403);
        }
        foreach (array_filter(explode('|', $required)) as $permission) {
            if (!in_array(str_replace('.', ':', $permission), $data['effective'], true)) {
                return $this->error('FORBIDDEN', 403);
            }
        }
        $request->attributes->set('ledgerActor', ['subject' => $identity['sub'], 'employeeId' => strtolower($data['employeeId']), 'permissions' => $data['effective']]);
        return $next($request);
    }

    private function error(string $code, int $status): Response
    {
        return response()->json(['statusCode' => $status, 'code' => $code, 'message' => 'Request failed'], $status);
    }
}
