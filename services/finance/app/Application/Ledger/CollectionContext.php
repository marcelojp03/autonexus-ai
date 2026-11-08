<?php

namespace App\Application\Ledger;

interface CollectionContext
{
    public function get(string $orderId, string $token): array;
}
