<?php

namespace App\Infrastructure\Cu15;

use App\Application\Cu15\QuoteLinkStore;
use App\Application\Cu15\QuoteLinks;
use App\Domain\CanonicalJson;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class SqlQuoteLinkStore implements QuoteLinkStore
{
    public function transaction(string $operationId, string $sagaId, Closure $work): array
    {
        return DB::transaction(function () use ($operationId, $sagaId, $work) {
            // Advisory locks also serialize absent rows, including cancel-before-authorize.
            foreach (['operation:'.$operationId, 'saga:'.$sagaId] as $key) {
                DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['finance.cu15:'.$key]);
            }
            return $work();
        }, 3);
    }

    public function operation(string $operationId): ?array
    {
        $row = DB::table('cu15_operations')->where('operation_id', $operationId)->first();
        return $row === null ? null : json_decode($row->result, true, 512, JSON_THROW_ON_ERROR);
    }

    public function link(string $sagaId): ?array
    {
        $query = DB::table('quote_confirmation_links')->where('saga_id', $sagaId);
        if (DB::transactionLevel() > 0) {
            $query->lockForUpdate();
        }
        $row = $query->first();
        return $row === null ? null : json_decode($row->resource, true, 512, JSON_THROW_ON_ERROR);
    }

    public function quote(string $quoteId): ?array
    {
        $row = DB::table('quotes')->where('id', $quoteId)->lockForUpdate()->first();
        if ($row !== null) {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['finance.cu15:order:'.strtolower($row->order_reference)]);
        }
        return $row === null ? null : (array) $row;
    }

    public function approval(string $quoteId): ?array
    {
        $row = DB::table('quote_decisions')->where('quote_id', $quoteId)->lockForUpdate()->first();
        return $row === null ? null : (array) $row;
    }

    public function occupied(string $orderId, string $quoteId): bool
    {
        return DB::table('quote_confirmation_links')->where('status', 'active')
            ->where(fn ($query) => $query->where('order_id', $orderId)->orWhere('quote_id', $quoteId))->exists();
    }

    public function saveLink(array $resource, ?array $approval, array $body): void
    {
        $existing = DB::table('quote_confirmation_links')->where('saga_id', $resource['sagaId'])->lockForUpdate()->first();
        if ($existing !== null) {
            DB::table('quote_confirmation_links')->where('saga_id', $resource['sagaId'])->update([
                'status' => $resource['status'], 'version' => $resource['version'],
                'resource' => CanonicalJson::encode($resource), 'cancelled_at' => now('UTC'),
                'cancel_reason' => $body['reasonCode'],
            ]);
            return;
        }
        DB::table('quote_confirmation_links')->insert([
            'saga_id' => $resource['sagaId'], 'id' => $resource['id'] ?? null,
            'order_id' => $resource['orderId'] ?? null, 'quote_id' => $resource['quoteId'] ?? null,
            'quote_version' => $resource['quoteVersion'] ?? null, 'status' => $resource['status'],
            'version' => $resource['version'], 'authorized_at' => $resource['authorizedAt'] ?? null,
            'valid_until' => $resource['validUntil'] ?? null, 'approval_snapshot' => $approval === null ? null : CanonicalJson::encode($approval),
            'initiated_by' => $body['initiatedBy'], 'initiation_authorized_at' => $body['authorizedAt'],
            'cancelled_at' => $resource['status'] === 'cancelled' ? now('UTC') : null,
            'cancel_reason' => $body['reasonCode'] ?? null, 'resource' => CanonicalJson::encode($resource),
        ]);
    }

    public function commitResult(array $result, array $body): void
    {
        $resource = $result['resource'];
        DB::table('cu15_operations')->insert([
            'operation_id' => $result['operationId'], 'saga_id' => $result['sagaId'],
            'command' => $result['command'], 'fingerprint' => $result['fingerprint'], 'outcome' => $result['outcome'],
            'result' => CanonicalJson::encode($result), 'committed_at' => $result['committedAt'],
        ]);
        DB::table('cu15_audit')->insert([
            'id' => (string) Str::uuid(), 'operation_id' => $result['operationId'], 'saga_id' => $result['sagaId'],
            'command' => $result['command'], 'outcome' => $result['outcome'], 'error_code' => $result['errorCode'],
            'initiated_by' => $body['initiatedBy'], 'executed_by' => QuoteLinks::CLIENT,
            'authorized_at' => $body['authorizedAt'], 'committed_at' => $result['committedAt'],
        ]);
        $type = $result['outcome'] === 'rejected' ? 'finance.cu15.command.rejected.v1'
            : ($result['command'] === 'authorize_quote' ? 'finance.cu15.quote_link.authorized.v1' : 'finance.cu15.quote_link.cancelled.v1');
        $eventId = (string) Str::uuid();
        $data = $result['outcome'] === 'rejected' ? [
            'sagaId' => $result['sagaId'], 'operationId' => $result['operationId'],
            'command' => $result['command'], 'errorCode' => $result['errorCode'],
        ] : [
            ...$resource, 'quoteLinkId' => $resource['id'] ?? null,
            ...($result['command'] === 'cancel_quote_link' ? ['reasonCode' => $body['reasonCode']] : []),
        ];
        $event = [
            'eventId' => $eventId, 'schemaVersion' => 1, 'eventType' => $type, 'producer' => 'finance',
            'aggregateType' => 'quote_confirmation_link', 'aggregateId' => $resource['id'] ?? $result['sagaId'],
            'aggregateVersion' => $resource['version'] ?? 0, 'correlationId' => $result['sagaId'],
            'causationId' => $result['operationId'], 'occurredAt' => $result['committedAt'],
            'initiatedBy' => $body['initiatedBy'], 'executedBy' => QuoteLinks::CLIENT, 'data' => $data,
        ];
        DB::table('cu15_outbox')->insert([
            'id' => $eventId, 'event_type' => $type, 'aggregate_type' => $event['aggregateType'],
            'aggregate_id' => $event['aggregateId'], 'aggregate_version' => $event['aggregateVersion'],
            'saga_id' => $result['sagaId'], 'causation_id' => $result['operationId'],
            'payload' => CanonicalJson::encode($event), 'occurred_at' => $result['committedAt'],
            'attempts' => 0, 'next_attempt_at' => $result['committedAt'],
        ]);
    }
}
