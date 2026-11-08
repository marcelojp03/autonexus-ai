<?php

namespace App\Infrastructure\Ledger;

use App\Application\Ledger\DocumentRelocationRepository;
use Illuminate\Support\Facades\DB;
use RuntimeException;

final class SqlDocumentRelocationRepository implements DocumentRelocationRepository
{
    public function locked(callable $work): mixed
    {
        return DB::transaction(function () use ($work) {
            if (DB::getDriverName() === 'pgsql') {
                DB::statement('LOCK TABLE expense_documents, expense_document_relocations, expense_document_relocation_items, expense_document_storage_history IN ACCESS EXCLUSIVE MODE');
            } elseif (DB::getDriverName() === 'sqlite') {
                // A write reservation prevents a deferred SQLite transaction from accepting concurrent uploads.
                DB::statement('UPDATE expense_documents SET object_version = object_version WHERE 1 = 0');
            } else { throw new RuntimeException('RELOCATION_DATABASE_UNSUPPORTED'); }
            return $work();
        }, 1);
    }

    public function uploaded(): array
    {
        return DB::table('expense_documents')->whereNotNull('object_version')->orderBy('id')->get()->map(function ($row) {
            $document = (array) $row;
            $document['size_bytes'] = (int) $document['size_bytes'];
            return $document;
        })->all();
    }

    public function transfer(string $operationId): ?array
    {
        $row = DB::table('expense_document_relocations')->where('operation_id', $operationId)->first();
        return $row === null ? null : (array) $row;
    }

    public function start(array $transfer): void { DB::table('expense_document_relocations')->insert($transfer); }
    public function prepareItem(array $item): void { DB::table('expense_document_relocation_items')->insert($item); }

    public function items(string $operationId): array
    {
        return DB::table('expense_document_relocation_items')->where('operation_id', $operationId)->orderBy('document_id')->get()
            ->map(fn ($row) => (array) $row)->keyBy('document_id')->all();
    }

    public function history(string $operationId): array
    {
        return DB::table('expense_document_storage_history')->where('operation_id', $operationId)->get()
            ->map(fn ($row) => (array) $row)->keyBy('document_id')->all();
    }

    public function relocate(array $item, string $committedAt): void
    {
        $changed = DB::table('expense_documents')->where('id', $item['document_id'])->where('object_version', $item['old_version'])
            ->update(['object_version' => $item['new_version']]);
        if ($changed !== 1) { throw new RuntimeException('RELOCATION_DOCUMENT_CHANGED'); }
        DB::table('expense_document_storage_history')->insert([...$item, 'committed_at' => $committedAt]);
    }

    public function committed(string $operationId, string $committedAt): void
    {
        DB::table('expense_document_relocations')->where('operation_id', $operationId)->update(['state' => 'committed', 'committed_at' => $committedAt]);
    }
}
