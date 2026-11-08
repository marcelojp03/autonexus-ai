<?php

namespace App\Infrastructure\Ledger;

use App\Application\Ledger\CollectionContext;
use App\Application\Ledger\LedgerError;
use Illuminate\Support\Facades\Http;

final class HttpCollectionContext implements CollectionContext
{
    public function get(string $orderId, string $token): array
    {
        try {
            $response = Http::withToken($token)->acceptJson()->timeout(4)->withoutRedirecting()
                ->get(rtrim(config('financial-ledger.operations_url'), '/').'/orders/'.rawurlencode($orderId).'/collection-context');
        } catch (\Throwable) {
            throw new LedgerError('COLLECTION_CONTEXT_UNAVAILABLE', 503);
        }
        if ($response->status() === 404) {
            throw new LedgerError('OBLIGATION_NOT_FOUND', 404);
        }
        if ($response->status() === 403) {
            throw new LedgerError('FORBIDDEN', 403);
        }
        $data = $response->json();
        $fields = ['orderId', 'orderNumber', 'orderVersion', 'orderStatus', 'sagaId', 'sagaStatus', 'quoteId', 'quoteVersion', 'quoteLinkId', 'eligibleForCollection', 'reasonCode', 'observedAt'];
        if (!$response->successful() || !is_array($data) || array_diff($fields, array_keys($data)) !== []
            || ($data['orderId'] ?? null) !== $orderId || !is_string($data['orderNumber']) || !is_int($data['orderVersion'])
            || !is_string($data['orderStatus']) || !is_string($data['observedAt']) || !is_bool($data['eligibleForCollection'])) {
            throw new LedgerError('COLLECTION_CONTEXT_UNAVAILABLE', 503);
        }
        foreach (['sagaId', 'quoteId', 'quoteLinkId'] as $key) {
            if ($data[$key] !== null && (!is_string($data[$key]) || !\Illuminate\Support\Str::isUuid($data[$key]))) {
                throw new LedgerError('COLLECTION_CONTEXT_UNAVAILABLE', 503);
            }
        }
        if (($data['quoteVersion'] !== null && (!is_int($data['quoteVersion']) || $data['quoteVersion'] < 1))
            || ($data['sagaStatus'] !== null && !is_string($data['sagaStatus']))
            || ($data['reasonCode'] !== null && !is_string($data['reasonCode']))) {
            throw new LedgerError('COLLECTION_CONTEXT_UNAVAILABLE', 503);
        }
        return $data;
    }
}
