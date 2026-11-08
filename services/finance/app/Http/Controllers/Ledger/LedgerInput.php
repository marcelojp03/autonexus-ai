<?php

namespace App\Http\Controllers\Ledger;

use App\Application\Ledger\LedgerError;
use App\Domain\Ledger\Money;
use Illuminate\Support\Str;

final class LedgerInput
{
    public static function uuid(mixed $id): string
    {
        if (!is_string($id) || !Str::isUuid($id)) {
            throw new LedgerError('VALIDATION_ERROR', 400);
        }
        return strtolower($id);
    }

    public static function body(string $action, array $b): array
    {
        $required = match ($action) {
            'record_payment' => ['operationId', 'expectedVersion', 'amountMinor', 'method', 'confirmReceived'],
            'verify_reference' => ['operationId', 'method', 'amountMinor', 'reference', 'note'],
            'record_expense' => ['operationId', 'description', 'categoryId', 'expenseDate', 'amountMinor', 'method'],
        };
        $optional = match ($action) {
            'record_payment' => ['referenceVerificationId'],
            'verify_reference' => [],
            'record_expense' => ['documentId', 'duplicateOf', 'duplicateReason'],
        };
        self::closed($b, [...$required, ...$optional]);
        foreach ($required as $key) {
            if (!array_key_exists($key, $b) || $b[$key] === null) {
                throw new LedgerError('VALIDATION_ERROR', 400);
            }
        }
        foreach (['operationId', 'categoryId', 'referenceVerificationId', 'documentId', 'duplicateOf'] as $key) {
            if (isset($b[$key])) {
                $b[$key] = self::uuid($b[$key]);
            }
        }
        foreach ($optional as $key) {
            $b[$key] ??= null;
        }
        try {
            Money::minor($b['amountMinor'], true);
        } catch (\InvalidArgumentException) {
            throw new LedgerError('VALIDATION_ERROR', 400);
        }
        if (!is_string($b['method']) || !in_array($b['method'], config('financial-ledger.methods'), true)) {
            throw new LedgerError('VALIDATION_ERROR', 400);
        }
        if ($action === 'record_payment') {
            if (!is_int($b['expectedVersion']) || $b['expectedVersion'] < 0 || $b['expectedVersion'] > 2147483647
                || $b['confirmReceived'] !== true || ($b['method'] === 'cash' && $b['referenceVerificationId'] !== null)) {
                throw new LedgerError('VALIDATION_ERROR', 400);
            }
        }
        if ($action === 'verify_reference') {
            $b['note'] = self::text($b['note'], 3, 1600);
            if (!is_string($b['reference']) || $b['method'] === 'cash') {
                throw new LedgerError('VALIDATION_ERROR', 400);
            }
            $ref = trim($b['reference']);
            if (!preg_match('/^[A-Za-z0-9_\/-]{3,120}$/D', $ref)) {
                throw new LedgerError('VALIDATION_ERROR', 400);
            }
            $b['reference'] = strtoupper($ref);
        }
        if ($action === 'record_expense') {
            $b['description'] = self::text($b['description'], 3, 1600);
            $b['expenseDate'] = self::date($b['expenseDate']);
            if ($b['expenseDate'] > (new \DateTimeImmutable('now', new \DateTimeZone('America/La_Paz')))->format('Y-m-d')) {
                throw new LedgerError('VALIDATION_ERROR', 400);
            }
            if ($b['duplicateOf'] !== null) {
                $b['duplicateReason'] = self::text($b['duplicateReason'], 10, 500);
            } elseif ($b['duplicateReason'] !== null) {
                throw new LedgerError('VALIDATION_ERROR', 400);
            }
        }
        return $b;
    }

    public static function query(array $q, array $allowed, bool $periodRequired = false): array
    {
        self::closed($q, $allowed);
        foreach (['from', 'to'] as $key) {
            if (array_key_exists($key, $q)) {
                $q[$key] = self::date($q[$key]);
            } elseif ($periodRequired) {
                throw new LedgerError('VALIDATION_ERROR', 400);
            }
        }
        if (isset($q['from'], $q['to']) && $q['from'] > $q['to']) {
            throw new LedgerError('VALIDATION_ERROR', 400);
        }
        foreach (['limit' => [1, 100], 'offset' => [0, 2147483647]] as $key => [$min, $max]) {
            if (isset($q[$key])) {
                if (!is_string($q[$key]) || !preg_match('/^(0|[1-9][0-9]{0,9})$/D', $q[$key]) || (int) $q[$key] < $min || (int) $q[$key] > $max) {
                    throw new LedgerError('VALIDATION_ERROR', 400);
                }
                $q[$key] = (int) $q[$key];
            }
        }
        if (isset($q['categoryId'])) {
            $q['categoryId'] = self::uuid($q['categoryId']);
        }
        if (isset($q['status']) && !in_array($q['status'], ['pending', 'paid', 'all'], true)) {
            throw new LedgerError('VALIDATION_ERROR', 400);
        }
        return $q;
    }

    private static function closed(array $values, array $allowed): void
    {
        if (array_diff(array_keys($values), $allowed) !== []) {
            throw new LedgerError('VALIDATION_ERROR', 400);
        }
    }

    private static function text(mixed $value, int $min, int $max): string
    {
        if (!is_string($value) || mb_strlen(trim($value)) < $min || mb_strlen(trim($value)) > $max) {
            throw new LedgerError('VALIDATION_ERROR', 400);
        }
        return trim($value);
    }

    private static function date(mixed $value): string
    {
        if (!is_string($value) || !preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/D', $value)) {
            throw new LedgerError('VALIDATION_ERROR', 400);
        }
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $value, new \DateTimeZone('America/La_Paz'));
        if ($d === false || $d->format('Y-m-d') !== $value) {
            throw new LedgerError('VALIDATION_ERROR', 400);
        }
        return $value;
    }
}
