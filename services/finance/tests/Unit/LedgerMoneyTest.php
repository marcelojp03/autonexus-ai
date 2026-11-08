<?php

namespace Tests\Unit;

use App\Domain\Ledger\Money;
use App\Domain\Ledger\CollectionPolicy;
use PHPUnit\Framework\TestCase;

final class LedgerMoneyTest extends TestCase
{
    public function test_decimal_and_large_arithmetic_are_exact(): void
    {
        self::assertSame('999999999999', Money::decimal('9999999999.99'));
        self::assertSame('1', Money::decimal('0.01'));
        self::assertSame('1000000000000', Money::add('999999999999', '1'));
        self::assertSame('999999999998', Money::subtract('999999999999', '1'));
        self::assertSame('-100', Money::subtract('0', '100'));
    }

    public function test_money_rejects_float_and_noncanonical_input(): void
    {
        foreach ([1, 1.0, '01', '-1', '1.0', '1000000000000', '1e2', ''] as $value) {
            try { Money::minor($value); self::fail('Accepted invalid money'); }
            catch (\InvalidArgumentException) { self::assertTrue(true); }
        }
    }

    public function test_full_only_policy(): void
    {
        self::assertSame('PAYMENT_PARTIAL_UNSUPPORTED', CollectionPolicy::paymentError('1', '100'));
        self::assertSame('PAYMENT_EXCEEDS_BALANCE', CollectionPolicy::paymentError('101', '100'));
        self::assertSame('NO_BALANCE_DUE', CollectionPolicy::paymentError('1', '0'));
        self::assertSame('BALANCE_INCONSISTENT', CollectionPolicy::paymentError('1', '-1'));
        self::assertNull(CollectionPolicy::paymentError('999999999999', '999999999999'));
    }
}
