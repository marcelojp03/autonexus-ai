<?php

namespace Tests\Unit;

use App\Domain\QuotePolicy;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class QuotePolicyTest extends TestCase
{
    private function items(): array
    {
        return [
            ['serviceReference' => 'a', 'description' => 'Pastillas', 'quantity' => 2, 'unitPrice' => 150.50],
            ['serviceReference' => 'b', 'description' => 'Alineación', 'quantity' => 1, 'unitPrice' => 99.99],
        ];
    }

    public function test_it_computes_subtotal_discount_tax_and_total(): void
    {
        $result = QuotePolicy::calculate($this->items(), 10, 13);
        $this->assertSame(400.99, $result['subtotal']);
        $this->assertSame(40.10, $result['discountAmount']);
        $this->assertSame(46.92, $result['taxAmount']);
        $this->assertSame(407.81, $result['total']);
        $this->assertCount(2, $result['items']);
        $this->assertSame(301.00, $result['items'][0]['lineTotal']);
    }

    public function test_it_rejects_discounts_above_the_authorized_limit(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('DISCOUNT_NOT_AUTHORIZED');
        QuotePolicy::calculate($this->items(), 20.01, 13);
    }

    public function test_it_rejects_duplicates_and_invalid_quantities(): void
    {
        $this->expectException(InvalidArgumentException::class);
        QuotePolicy::calculate([
            ['serviceReference' => 'a', 'description' => 'x', 'quantity' => 1, 'unitPrice' => 10],
            ['serviceReference' => 'a', 'description' => 'y', 'quantity' => 1, 'unitPrice' => 10],
        ], 0, 13);
    }

    public function test_it_rejects_an_empty_quote(): void
    {
        $this->expectException(InvalidArgumentException::class);
        QuotePolicy::calculate([], 0, 13);
    }

    public function test_it_validates_declared_totals(): void
    {
        QuotePolicy::assertConsistent(null, 100.0);
        QuotePolicy::assertConsistent(100.0, 100.004);
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('QUOTE_TOTAL_MISMATCH');
        QuotePolicy::assertConsistent(50.0, 100.0);
    }
}
