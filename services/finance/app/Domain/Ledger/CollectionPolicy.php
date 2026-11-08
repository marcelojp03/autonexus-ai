<?php

namespace App\Domain\Ledger;

final class CollectionPolicy
{
    public const CODE = 'FULL_AFTER_COMPLETION_V1';

    public static function paymentError(string $amount, string $balance): ?string
    {
        if (str_starts_with($balance, '-')) {
            return 'BALANCE_INCONSISTENT';
        }
        if ($balance === '0') {
            return 'NO_BALANCE_DUE';
        }
        return match (Money::compare($amount, $balance) <=> 0) {
            -1 => 'PAYMENT_PARTIAL_UNSUPPORTED',
            1 => 'PAYMENT_EXCEEDS_BALANCE',
            default => null,
        };
    }
}
