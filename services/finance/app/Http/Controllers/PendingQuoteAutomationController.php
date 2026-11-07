<?php

namespace App\Http\Controllers;

use App\Application\Cu28\PendingQuotes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

final class PendingQuoteAutomationController extends Controller
{
    public function __invoke(Request $request, PendingQuotes $quotes): JsonResponse
    {
        if ($request->query->count() !== 0 || $request->all() !== []) abort(400, 'VALIDATION_ERROR');
        try {
            $response = Http::withToken($request->bearerToken())->acceptJson()->timeout(2)
                ->withoutRedirecting()->get(rtrim(config('finance.employees_url'), '/').'/security/permissions');
        } catch (\Throwable) {
            abort(503, 'EMPLOYEE_AUTHORIZATION_UNAVAILABLE');
        }
        if ($response->status() === 401) abort(401, 'UNAUTHORIZED');
        if ($response->serverError()) abort(503, 'EMPLOYEE_AUTHORIZATION_UNAVAILABLE');
        $employeeId = $response->json('employeeId');
        $permissions = $response->json('effective');
        if (!$response->successful() || $response->json('employeeStatus') !== 'active'
            || !is_string($employeeId) || !Str::isUuid($employeeId)
            || !is_array($permissions) || !in_array('quotes:read', $permissions, true)) {
            abort(403, 'FORBIDDEN');
        }
        return response()->json(['events' => $quotes->collect($employeeId)]);
    }
}
