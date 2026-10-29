<?php

namespace App\Application\Cu15;

use App\Domain\CanonicalJson;
use App\Domain\QuoteLinkPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

final class QuoteLinks
{
    public const CLIENT = 'autonexus-cu15-coordinator';

    public function __construct(private readonly QuoteLinkStore $store) {}

    public function execute(string $command, string $sagaId, array $body): array
    {
        $fingerprint = hash('sha256', CanonicalJson::encode([
            'clientId' => self::CLIENT, 'command' => $command, 'sagaId' => $sagaId, 'body' => $body,
        ]));
        return $this->store->transaction($body['operationId'], $sagaId, function () use ($command, $sagaId, $body, $fingerprint) {
            $old = $this->store->operation($body['operationId']);
            if ($old !== null) {
                if ($old['fingerprint'] !== $fingerprint) {
                    throw new ProtocolError('IDEMPOTENCY_CONFLICT');
                }
                return [...$old, 'replayed' => true];
            }
            $link = $this->store->link($sagaId);
            $approval = null;
            if ($command === 'authorize_quote') {
                $quote = $this->store->quote($body['quoteId']);
                $approval = $this->store->approval($body['quoteId']);
                $occupied = $this->store->occupied($body['orderId'], $body['quoteId']);
                $now = CarbonImmutable::now('UTC');
                $error = QuoteLinkPolicy::authorize($quote, $approval, $link, $body, $occupied, $now);
                $resource = $error === null ? [
                    'id' => (string) Str::uuid(), 'sagaId' => $sagaId, 'orderId' => $body['orderId'],
                    'quoteId' => $body['quoteId'], 'quoteVersion' => $body['quoteVersion'],
                    'status' => 'active', 'version' => 1, 'authorizedAt' => $now->format('Y-m-d\TH:i:s.v\Z'),
                    'validUntil' => $quote['valid_until'],
                ] : null;
            } else {
                $now = CarbonImmutable::now('UTC');
                $error = QuoteLinkPolicy::cancel($link, $body['expectedVersion']);
                $resource = $error === null ? ($link === null ? [
                    'sagaId' => $sagaId, 'status' => 'cancelled', 'version' => 1, 'tombstone' => true,
                ] : [...$link, 'status' => 'cancelled', 'version' => $link['version'] + 1]) : null;
            }
            if ($resource !== null) {
                $this->store->saveLink($resource, $approval, $body);
            }
            $result = [
                'operationId' => $body['operationId'], 'sagaId' => $sagaId, 'command' => $command,
                'fingerprint' => $fingerprint, 'outcome' => $error === null ? 'applied' : 'rejected',
                'resource' => $resource, 'errorCode' => $error, 'committedAt' => $now->format('Y-m-d\TH:i:s.v\Z'), 'replayed' => false,
            ];
            $this->store->commitResult($result, $body);
            return $result;
        });
    }

    public function operation(string $id): array
    {
        return $this->store->operation($id) ?? throw new ProtocolError('OPERATION_NOT_FOUND');
    }

    public function link(string $id): array
    {
        return $this->store->link($id) ?? throw new ProtocolError('QUOTE_LINK_NOT_FOUND');
    }
}
