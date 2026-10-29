<?php

namespace App\Http\Controllers;

use App\Application\Cu15\QuoteLinks;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Validator;

final class QuoteLinkController extends Controller
{
    public function __construct(private readonly QuoteLinks $links) {}

    public function authorize(Request $request, string $sagaId): JsonResponse
    {
        return $this->command($request, $sagaId, 'authorize_quote');
    }

    public function cancel(Request $request, string $sagaId): JsonResponse
    {
        return $this->command($request, $sagaId, 'cancel_quote_link');
    }

    public function show(string $sagaId): JsonResponse
    {
        $this->uuid($sagaId);
        return response()->json($this->links->link(strtolower($sagaId)));
    }

    public function operation(string $operationId): JsonResponse
    {
        $this->uuid($operationId);
        return response()->json($this->links->operation(strtolower($operationId)));
    }

    private function command(Request $request, string $sagaId, string $command): JsonResponse
    {
        $this->uuid($sagaId);
        $rules = [
            'operationId' => ['required', 'uuid'], 'expectedVersion' => ['required', 'integer', 'min:0'],
            'initiatedBy' => ['required', 'string', 'max:255', 'regex:/^[A-Za-z0-9:_@.\-]+$/'],
            'authorizedAt' => ['required', 'string', 'regex:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/', 'date'],
        ];
        $rules += $command === 'authorize_quote' ? [
            'orderId' => ['required', 'uuid'], 'quoteId' => ['required', 'uuid'],
            'quoteVersion' => ['required', 'integer', 'min:1'],
        ] : ['reasonCode' => ['required', 'string', 'max:64', 'regex:/^[A-Z][A-Z0-9_]*$/']];
        $body = $request->json()->all();
        if (array_diff(array_keys($body), array_keys($rules)) !== [] || Validator::make($body, $rules)->fails()
            || !is_int($body['expectedVersion'] ?? null)
            || ($command === 'authorize_quote' && (!is_int($body['quoteVersion'] ?? null) || $body['expectedVersion'] !== 0))) {
            abort(400, 'VALIDATION_ERROR');
        }
        foreach (['operationId', 'orderId', 'quoteId'] as $key) {
            if (isset($body[$key])) {
                $body[$key] = strtolower($body[$key]);
            }
        }
        $body['authorizedAt'] = CarbonImmutable::parse($body['authorizedAt'])->utc()->format('Y-m-d\TH:i:s.v\Z');
        $result = $this->links->execute($command, strtolower($sagaId), $body);
        return response()->json($result, $result['outcome'] === 'rejected' ? 409 : 200);
    }

    private function uuid(string $id): void
    {
        if (!Str::isUuid($id)) {
            abort(400, 'VALIDATION_ERROR');
        }
    }
}
