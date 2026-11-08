<?php

namespace App\Infrastructure\Ledger;

use App\Application\Ledger\LedgerError;
use App\Application\Ledger\LedgerStore;
use App\Domain\CanonicalJson;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class SqlLedgerStore implements LedgerStore
{
    private const COLLECTIONS = ['obligations', 'payments', 'receipts', 'verifications', 'expenses', 'categories', 'operations', 'audit'];

    public function transaction(\Closure $work): mixed
    {
        return DB::transaction($work, 3);
    }

    public function lock(string $key): void
    {
        DB::table('financial_ledger_locks')->insertOrIgnore(['key' => $key]);
        DB::table('financial_ledger_locks')->where('key', $key)->lockForUpdate()->first();
    }

    public function rows(string $collection): array
    {
        return DB::table($this->table($collection))->orderBy('id')->get()->map(fn ($r) => json_decode($r->record, true, 512, JSON_THROW_ON_ERROR))->all();
    }

    public function find(string $collection, string $id): ?array
    {
        $q = DB::table($this->table($collection))->where('id', $id);
        if (DB::transactionLevel() > 0) {
            $q->lockForUpdate();
        }
        $r = $q->first();
        return $r === null ? null : json_decode($r->record, true, 512, JSON_THROW_ON_ERROR);
    }

    public function put(string $collection, string $id, array $record): void
    {
        if ($collection === 'obligations') {
            DB::table($this->table($collection))->updateOrInsert(['id' => $id], ['record' => CanonicalJson::encode($record)]);
        } else {
            $values = ['id' => $id, 'record' => CanonicalJson::encode($record)];
            if ($collection === 'receipts') {
                $values['receipt_id'] = $record['id'];
                $values['receipt_number'] = $record['number'];
            }
            DB::table($this->table($collection))->insert($values);
        }
    }

    public function linkedQuote(string $orderId): ?array
    {
        $q = DB::table('quote_confirmation_links')->where('order_id', $orderId)->where('status', 'active');
        if (DB::transactionLevel() > 0) {
            $q->lockForUpdate();
        }
        $link = $q->first();
        if ($link === null) {
            return null;
        }
        $q = DB::table('quotes')->where('id', $link->quote_id)->select(['id', 'version_number', 'currency', 'order_reference'])->selectRaw('CAST(total AS TEXT) AS exact_total');
        if (DB::transactionLevel() > 0) {
            $q->lockForUpdate();
        }
        $quote = $q->first();
        return ['link' => (array) $link, 'quote' => $quote === null ? null : (array) $quote];
    }

    public function activeOrderIds(): array
    {
        return DB::table('quote_confirmation_links')->where('status', 'active')->orderBy('order_id')->pluck('order_id')->all();
    }

    public function document(string $id): ?array
    {
        if (!Schema::hasTable('expense_documents')) {
            throw new LedgerError('DOCUMENT_STORAGE_UNAVAILABLE', 503);
        }
        $r = DB::table('expense_documents')->where('id', $id)->lockForUpdate()->first();
        return $r === null ? null : (array) $r;
    }

    public function attachDocument(string $id, string $expenseId): void
    {
        DB::table('expense_documents')->where('id', $id)->update(['expense_id' => $expenseId]);
    }

    private function table(string $name): string
    {
        if (!in_array($name, self::COLLECTIONS, true)) {
            throw new \LogicException('Unknown ledger collection');
        }
        return 'financial_'.$name;
    }
}
