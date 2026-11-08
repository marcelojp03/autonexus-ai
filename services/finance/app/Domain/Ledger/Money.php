<?php

namespace App\Domain\Ledger;

use InvalidArgumentException;

final class Money
{
    public static function minor(mixed $value, bool $positive = false): string
    {
        if (!is_string($value) || !preg_match('/^(0|[1-9][0-9]{0,11})$/D', $value) || ($positive && $value === '0')) {
            throw new InvalidArgumentException('PAYMENT_AMOUNT_INVALID');
        }
        return $value;
    }

    public static function decimal(string $value): string
    {
        if (!preg_match('/^(0|[1-9][0-9]{0,9})(?:\.([0-9]{1,2}))?$/D', $value, $m)) {
            throw new InvalidArgumentException('BALANCE_INCONSISTENT');
        }
        return self::minor(ltrim($m[1].str_pad($m[2] ?? '', 2, '0'), '0') ?: '0');
    }

    public static function compare(string $a, string $b): int
    {
        return strlen($a) <=> strlen($b) ?: strcmp($a, $b);
    }

    public static function add(string $a, string $b): string
    {
        $out = '';
        $carry = 0;
        for ($i = strlen($a) - 1, $j = strlen($b) - 1; $i >= 0 || $j >= 0 || $carry; $i--, $j--) {
            $digit = ($i >= 0 ? ord($a[$i]) - 48 : 0) + ($j >= 0 ? ord($b[$j]) - 48 : 0) + $carry;
            $out = ($digit % 10).$out;
            $carry = intdiv($digit, 10);
        }
        return $out;
    }

    public static function subtract(string $a, string $b): string
    {
        if (self::compare($a, $b) < 0) {
            return '-'.self::subtract($b, $a);
        }
        $out = '';
        $borrow = 0;
        for ($i = strlen($a) - 1, $j = strlen($b) - 1; $i >= 0; $i--, $j--) {
            $digit = ord($a[$i]) - 48 - $borrow - ($j >= 0 ? ord($b[$j]) - 48 : 0);
            $borrow = $digit < 0 ? 1 : 0;
            $out = ($digit < 0 ? $digit + 10 : $digit).$out;
        }
        return ltrim($out, '0') ?: '0';
    }
}
