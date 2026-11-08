<?php

namespace App\Application\Ledger;

final class LedgerError extends \RuntimeException
{
    public function __construct(string $code, public readonly int $status = 409, public readonly array $details = [])
    {
        parent::__construct($code);
    }
}
