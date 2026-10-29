<?php

namespace App\Application\Cu15;

use Closure;

interface QuoteLinkStore
{
    public function transaction(string $operationId, string $sagaId, Closure $work): array;
    public function operation(string $operationId): ?array;
    public function link(string $sagaId): ?array;
    public function quote(string $quoteId): ?array;
    public function approval(string $quoteId): ?array;
    public function occupied(string $orderId, string $quoteId): bool;
    public function saveLink(array $resource, ?array $approval, array $body): void;
    public function commitResult(array $result, array $body): void;
}
