<?php

namespace App\Application\Ledger;

interface LedgerStore
{
    public function transaction(\Closure $work): mixed;
    public function lock(string $key): void;
    public function rows(string $collection): array;
    public function find(string $collection, string $id): ?array;
    public function put(string $collection, string $id, array $record): void;
    public function linkedQuote(string $orderId): ?array;
    public function activeOrderIds(): array;
    public function document(string $id): ?array;
    public function attachDocument(string $id, string $expenseId): void;
}
