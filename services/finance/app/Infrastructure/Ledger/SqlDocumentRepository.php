<?php

namespace App\Infrastructure\Ledger;

use App\Application\Ledger\DocumentRepository;
use Illuminate\Support\Facades\DB;

final class SqlDocumentRepository implements DocumentRepository
{
    public function find(string $id): ?array
    {
        $r = DB::table('expense_documents')->where('id', $id)->lockForUpdate()->first();
        return $r === null ? null : (array) $r;
    }

    public function insert(array $document): void { DB::table('expense_documents')->insert($document); }
    public function uploaded(string $id, string $version): void { DB::table('expense_documents')->where('id', $id)->update(['object_version' => $version]); }
    public function available(string $id): void { DB::table('expense_documents')->where('id', $id)->update(['state' => 'available']); }
    public function grant(array $grant): void { DB::table('expense_document_grants')->insert($grant); }
    public function findGrant(string $hash): ?array
    {
        $r = DB::table('expense_document_grants')->where('hash', $hash)->first();
        return $r === null ? null : (array) $r;
    }
}
