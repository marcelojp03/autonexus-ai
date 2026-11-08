<?php

namespace Tests\Feature;

use App\Application\Ledger\DocumentRelocation;
use App\Application\Ledger\DocumentStorage;
use App\Infrastructure\Ledger\S3DocumentStorage;
use App\Infrastructure\Ledger\SqlDocumentRelocationRepository;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class DocumentRelocationTest extends TestCase
{
    private DocumentRelocation $service;
    private RelocationStorage $source;
    private RelocationStorage $target;
    private string $bytes;
    private string $operation = '11111111-1111-4111-8111-111111111111';
    private string $document = '22222222-2222-4222-8222-222222222222';
    private array $money;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:', 'logging.default' => 'null']);
        DB::purge('sqlite');
        foreach (['000002_create_financial_ledger', '000003_create_expense_documents', '000004_create_document_relocations'] as $migration) {
            (require database_path('migrations/2026_11_07_'.$migration.'.php'))->up();
        }
        $this->bytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=');
        DB::table('expense_documents')->insert(['id' => $this->document, 'owner_subject' => 'synthetic', 'file_name' => 'receipt.png',
            'content_type' => 'image/png', 'size_bytes' => strlen($this->bytes), 'sha256' => hash('sha256', $this->bytes),
            'state' => 'available', 'object_key' => 'finance/expense-documents/'.$this->document, 'object_version' => 'original',
            'expense_id' => null, 'created_at' => '2026-11-07T00:00:00.000Z']);
        foreach (['payments', 'expenses', 'receipts', 'obligations', 'operations', 'audit'] as $table) {
            $row = ['id' => 'synthetic', 'record' => '{"amountMinor":"123"}'];
            if ($table === 'receipts') { $row += ['receipt_id' => $this->document, 'receipt_number' => 'SYNTHETIC-1']; }
            DB::table('financial_'.$table)->insert($row);
        }
        $this->money = $this->moneyHashes();
        $this->source = new RelocationStorage('original', $this->bytes);
        $this->target = new RelocationStorage('destination');
        $this->service = new DocumentRelocation(new SqlDocumentRelocationRepository);
    }

    protected function tearDown(): void
    {
        DB::disconnect('sqlite');
        parent::tearDown();
    }

    private function prepare(): array
    {
        return $this->service->prepare($this->operation, $this->source, $this->target, str_repeat('a', 64), str_repeat('b', 64));
    }

    private function commit(?callable $active = null, ?callable $ready = null): array
    {
        return $this->service->commit($this->operation, $this->target, str_repeat('b', 64),
            $active ?? fn () => str_repeat('b', 64), $ready ?? fn (array $message) => 'SWITCHED');
    }

    public function test_prepare_is_idempotent_and_never_changes_pointers(): void
    {
        $this->prepare();
        $this->prepare();
        $this->assertSame(1, $this->target->puts);
        $this->assertSame(1, DB::table('expense_document_relocation_items')->count());
        $this->assertSame('original', DB::table('expense_documents')->value('object_version'));
        $this->assertSame(0, DB::table('expense_document_storage_history')->count());
        $this->assertSame('allOld', $this->service->status($this->operation)['position']);
        $this->assertSame($this->money, $this->moneyHashes());
    }

    public function test_source_hash_mismatch_does_not_prepare_or_move_pointer(): void
    {
        $this->source->bytes = 'wrong';
        try { $this->prepare(); $this->fail('Expected mismatch'); } catch (\RuntimeException $e) {
            $this->assertSame('RELOCATION_CONTENT_MISMATCH', $e->getMessage());
        }
        $this->assertSame(0, $this->target->puts);
        $this->assertSame('original', DB::table('expense_documents')->value('object_version'));
    }

    public function test_target_reread_mismatch_does_not_save_mapping(): void
    {
        $this->target->corrupt = true;
        try { $this->prepare(); $this->fail('Expected mismatch'); } catch (\RuntimeException $e) {
            $this->assertSame('RELOCATION_CONTENT_MISMATCH', $e->getMessage());
        }
        $this->assertSame(0, DB::table('expense_document_relocation_items')->count());
        $this->assertSame('original', DB::table('expense_documents')->value('object_version'));
    }

    public function test_active_profile_mismatch_aborts_after_ready(): void
    {
        $this->prepare();
        $ready = false;
        try {
            $this->commit(fn () => str_repeat('a', 64), function ($message) use (&$ready) {
                $ready = true;
                $this->assertSame('READY_TO_SWITCH', $message['event']);
                return 'SWITCHED';
            });
            $this->fail('Expected mismatch');
        } catch (\RuntimeException $e) { $this->assertSame('RELOCATION_ACTIVE_PROFILE_MISMATCH', $e->getMessage()); }
        $this->assertTrue($ready);
        $this->assertSame('allOld', $this->service->status($this->operation)['position']);
        $this->assertSame(0, DB::table('expense_document_storage_history')->count());
    }

    public function test_commit_replay_preserves_snapshot_history_and_money(): void
    {
        $before = (array) DB::table('expense_documents')->first();
        $this->prepare();
        $active = str_repeat('a', 64);
        $this->assertSame('allNew', $this->commit(function () use (&$active) { return $active; }, function ($message) use (&$active) {
            $this->assertGreaterThan(0, DB::transactionLevel());
            $this->assertSame('READY_TO_SWITCH', $message['event']);
            $active = str_repeat('b', 64);
            return 'SWITCHED';
        })['position']);
        $this->assertSame('allNew', $this->commit(ready: function () { $this->fail('Replay must not switch again'); })['position']);
        $after = (array) DB::table('expense_documents')->first();
        $this->assertSame('destination', $after['object_version']);
        $after['object_version'] = $before['object_version'];
        $this->assertSame($before, $after);
        $this->assertSame(1, DB::table('expense_document_storage_history')->count());
        $this->assertSame($this->money, $this->moneyHashes());
    }

    public function test_history_insert_failure_rolls_back_pointer_and_journal(): void
    {
        $this->prepare();
        DB::unprepared("CREATE TRIGGER fixture_history_failure BEFORE INSERT ON expense_document_storage_history BEGIN SELECT RAISE(ABORT, 'fixture'); END");
        try { $this->commit(); $this->fail('Expected rollback'); } catch (\Illuminate\Database\QueryException) {}
        $this->assertSame('allOld', $this->service->status($this->operation)['position']);
        $this->assertSame('prepared', DB::table('expense_document_relocations')->value('state'));
        $this->assertSame($this->money, $this->moneyHashes());
    }

    public function test_unprepared_new_upload_blocks_ready_and_abort_keeps_metadata(): void
    {
        $this->prepare();
        $row = (array) DB::table('expense_documents')->first();
        $row['id'] = '33333333-3333-4333-8333-333333333333';
        $row['object_key'] .= '-second';
        DB::table('expense_documents')->insert($row);
        try { $this->commit(); $this->fail('Expected missing coverage'); } catch (\RuntimeException $e) {
            $this->assertSame('RELOCATION_COVERAGE_MISMATCH', $e->getMessage());
        }
        DB::table('expense_documents')->where('id', $row['id'])->delete();
        foreach (['ABORT', false] as $signal) {
            try { $this->commit(ready: fn () => $signal); $this->fail('Expected abort'); } catch (\RuntimeException $e) {
                $this->assertSame('RELOCATION_ABORTED', $e->getMessage());
            }
        }
        $this->assertSame('allOld', $this->service->status($this->operation)['position']);
    }

    public function test_history_is_append_only_and_unexpected_pointer_is_mixed(): void
    {
        $this->prepare();
        $this->commit();
        try { DB::table('expense_document_storage_history')->delete(); $this->fail('Expected append-only'); }
        catch (\Illuminate\Database\QueryException) {}
        try { DB::table('expense_document_storage_history')->update(['new_version' => 'changed']); $this->fail('Expected append-only'); }
        catch (\Illuminate\Database\QueryException) {}
        DB::table('expense_documents')->update(['object_version' => 'unexpected']);
        $this->assertSame('mixed', $this->service->status($this->operation)['position']);
    }

    private function moneyHashes(): array
    {
        $hashes = [];
        foreach (['payments', 'expenses', 'receipts', 'obligations', 'operations', 'audit'] as $table) {
            $hashes[$table] = hash('sha256', json_encode(DB::table('financial_'.$table)->orderBy('id')->get()->all(), JSON_THROW_ON_ERROR));
        }
        return $hashes;
    }

    public function test_operation_binds_profiles_and_journal_mapping_cannot_change(): void
    {
        $this->prepare();
        try {
            $this->service->prepare($this->operation, $this->source, $this->target, str_repeat('c', 64), str_repeat('b', 64));
            $this->fail('Expected conflict');
        } catch (\RuntimeException $e) { $this->assertSame('RELOCATION_IDEMPOTENCY_CONFLICT', $e->getMessage()); }
        try { DB::table('expense_document_relocation_items')->update(['new_version' => 'changed']); $this->fail('Expected immutable mapping'); }
        catch (\Illuminate\Database\QueryException) {}
        $this->assertSame('allOld', $this->service->status($this->operation)['position']);
    }

    public function test_equal_opaque_versions_across_providers_are_disambiguated_by_history(): void
    {
        $this->target = new RelocationStorage('original');
        $this->prepare();
        $this->assertSame('allOld', $this->service->status($this->operation)['position']);
        $this->assertSame('allNew', $this->commit()['position']);
    }

    public function test_uploaded_but_unconfirmed_document_is_also_covered(): void
    {
        DB::table('expense_documents')->update(['state' => 'pending']);
        $this->prepare();
        $this->assertSame('allNew', $this->commit()['position']);
        $this->assertSame('pending', DB::table('expense_documents')->value('state'));
    }

    public function test_status_command_uses_normal_discovery_and_no_storage_profile(): void
    {
        $this->prepare();
        config(['financial-ledger.document_storage_file' => null]);
        $this->artisan('finance:relocate-documents', ['mode' => 'status', 'operationId' => $this->operation])
            ->expectsOutputToContain('"position":"allOld"')->assertSuccessful();
    }

    public function test_explicit_profiles_are_independent_and_fingerprint_excludes_secret(): void
    {
        $sourceFile = tempnam(sys_get_temp_dir(), 'relocation-source-');
        $targetFile = tempnam(sys_get_temp_dir(), 'relocation-target-');
        $profile = ['endpoint' => 'http://127.0.0.1:4566', 'region' => 'us-east-1', 'bucket' => 'finance-fixture',
            'accessKey' => 'synthetic-access', 'secretKey' => 'synthetic-secret'];
        try {
            file_put_contents($sourceFile, json_encode($profile, JSON_THROW_ON_ERROR));
            file_put_contents($targetFile, json_encode([...$profile, 'secretKey' => 'rotated-synthetic-secret'], JSON_THROW_ON_ERROR));
            config(['financial-ledger.document_storage_file' => $sourceFile]);
            $source = new S3DocumentStorage($sourceFile);
            $this->assertSame($source->fingerprint(), (new S3DocumentStorage($targetFile))->fingerprint());
            file_put_contents($targetFile, json_encode([...$profile, 'bucket' => 'finance-destination'], JSON_THROW_ON_ERROR));
            $target = new S3DocumentStorage($targetFile);
            $this->assertNotSame($source->fingerprint(), $target->fingerprint());
            $this->assertSame($sourceFile, config('financial-ledger.document_storage_file'));
            $this->assertSame($source->fingerprint(), (new S3DocumentStorage)->fingerprint());
            file_put_contents($sourceFile, json_encode([...$profile, 'accessKey' => 'another-synthetic-access'], JSON_THROW_ON_ERROR));
            $this->assertNotSame($source->fingerprint(), (new S3DocumentStorage)->fingerprint());
        } finally { unlink($sourceFile); unlink($targetFile); }
    }
}

final class RelocationStorage implements DocumentStorage
{
    public int $puts = 0;
    public bool $corrupt = false;
    public function __construct(private string $version, public string $bytes = '') {}
    public function assertConfigured(): void {}
    public function put(string $key, string $bytes, string $contentType): string
    {
        $this->puts++;
        $this->bytes = $this->corrupt ? 'wrong' : $bytes;
        return $this->version;
    }
    public function get(string $key, string $version): string
    {
        if ($version !== $this->version) { throw new \RuntimeException('FIXTURE_VERSION_MISMATCH'); }
        return $this->bytes;
    }
}
