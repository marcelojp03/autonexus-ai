<?php

namespace App\Application\Ledger;

interface DocumentRepository
{
    public function find(string $id): ?array;
    public function insert(array $document): void;
    public function uploaded(string $id, string $version): void;
    public function available(string $id): void;
    public function grant(array $grant): void;
    public function findGrant(string $hash): ?array;
}
