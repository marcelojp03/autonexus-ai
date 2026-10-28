<?php

namespace App\Domain;

use InvalidArgumentException;

/** CU13 money rules. All amounts are computed on the server and never trusted from the client. */
final class QuotePolicy
{
    public const MAX_DISCOUNT_PERCENT = 20.0;

    /**
     * @param  list<array{serviceReference: string, description: string, quantity: int, unitPrice: float|string}>  $items
     * @return array{subtotal: float, discountPercent: float, discountAmount: float, taxPercent: float, taxAmount: float, total: float, items: list<array>}
     */
    public static function calculate(array $items, float $discountPercent, float $taxPercent): array
    {
        if ($items === [] || count($items) > 20) {
            throw new InvalidArgumentException('QUOTE_ITEMS_INVALID');
        }
        if ($discountPercent < 0 || $discountPercent > self::MAX_DISCOUNT_PERCENT) {
            throw new InvalidArgumentException('DISCOUNT_NOT_AUTHORIZED');
        }
        if ($taxPercent < 0 || $taxPercent > 30) {
            throw new InvalidArgumentException('TAX_INVALID');
        }
        $seen = [];
        $subtotal = 0.0;
        $lines = [];
        foreach ($items as $item) {
            $reference = (string) ($item['serviceReference'] ?? '');
            $quantity = (int) ($item['quantity'] ?? 0);
            $unitPrice = round((float) ($item['unitPrice'] ?? -1), 2);
            if ($reference === '' || isset($seen[$reference]) || $quantity < 1 || $quantity > 99 || $unitPrice < 0) {
                throw new InvalidArgumentException('QUOTE_ITEMS_INVALID');
            }
            $seen[$reference] = true;
            $lineTotal = round($quantity * $unitPrice, 2);
            $subtotal = round($subtotal + $lineTotal, 2);
            $lines[] = [
                'serviceReference' => $reference,
                'description' => (string) ($item['description'] ?? ''),
                'quantity' => $quantity,
                'unitPrice' => $unitPrice,
                'lineTotal' => $lineTotal,
            ];
        }
        $discountAmount = round($subtotal * $discountPercent / 100, 2);
        $base = round($subtotal - $discountAmount, 2);
        $taxAmount = round($base * $taxPercent / 100, 2);
        $total = round($base + $taxAmount, 2);
        return [
            'subtotal' => $subtotal,
            'discountPercent' => $discountPercent,
            'discountAmount' => $discountAmount,
            'taxPercent' => $taxPercent,
            'taxAmount' => $taxAmount,
            'total' => $total,
            'items' => $lines,
        ];
    }

    /** The client may send totals only as a consistency check; the server value always wins. */
    public static function assertConsistent(?float $declared, float $computed): void
    {
        if ($declared === null) {
            return;
        }
        if (abs($declared - $computed) > 0.009) {
            throw new InvalidArgumentException('QUOTE_TOTAL_MISMATCH');
        }
    }
}
