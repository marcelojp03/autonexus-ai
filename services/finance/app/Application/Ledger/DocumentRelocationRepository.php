<?php

namespace App\Application\Ledger;

interface DocumentRelocationRepository
{
    public function locked(callable $work): mixed;
    public function uploaded(): array;
    public function transfer(string $operationId): ?array;
    public function start(array $transfer): void;
    public function items(string $operationId): array;
    public function prepareItem(array $item): void;
    public function history(string $operationId): array;
    public function relocate(array $item, string $committedAt): void;
    public function committed(string $operationId, string $committedAt): void;
}
