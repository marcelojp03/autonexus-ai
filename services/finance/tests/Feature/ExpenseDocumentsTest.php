<?php

namespace Tests\Feature;

use App\Application\Ledger\DocumentStorage;
use App\Application\Ledger\LedgerError;
use App\Http\Middleware\AuthenticateFinancialLedger;
use App\Infrastructure\Ledger\S3DocumentStorage;
use Illuminate\Routing\Events\RouteMatched;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

final class ExpenseDocumentsTest extends TestCase
{
    private string $subject = 'document-owner';
    private MemoryDocumentStorage $storage;
    private string $bytes;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:', 'logging.default' => 'null']);
        DB::purge('sqlite');
        (require database_path('migrations/2026_11_07_000002_create_financial_ledger.php'))->up();
        (require database_path('migrations/2026_11_07_000003_create_expense_documents.php'))->up();
        $this->storage = new MemoryDocumentStorage;
        $this->app->instance(DocumentStorage::class, $this->storage);
        $this->withoutMiddleware(AuthenticateFinancialLedger::class);
        $this->app['events']->listen(RouteMatched::class, function ($event) {
            $event->request->attributes->set('ledgerActor', ['subject' => $this->subject, 'employeeId' => '55555555-5555-4555-8555-555555555555', 'permissions' => ['expenses:read', 'expenses:write']]);
        });
        $this->bytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=');
    }

    protected function tearDown(): void
    {
        DB::disconnect('sqlite');
        parent::tearDown();
    }

    private function input(array $override = []): array
    {
        return [...['operationId' => (string) Str::uuid(), 'fileName' => 'receipt.png', 'contentType' => 'image/png', 'sizeBytes' => strlen($this->bytes), 'sha256' => hash('sha256', $this->bytes)], ...$override];
    }

    private function upload(array $target, ?string $bytes = null, array $extraHeaders = [])
    {
        $bytes ??= $this->bytes;
        $headers = [...json_decode($target['headersJson'], true), ...$extraHeaders];
        $server = ['CONTENT_LENGTH' => (string) strlen($bytes), 'CONTENT_TYPE' => $headers['Content-Type']];
        foreach ($headers as $key => $value) { if ($key !== 'Content-Type') { $server['HTTP_'.strtoupper(str_replace('-', '_', $key))] = $value; } }
        return $this->call('PUT', $target['url'], [], [], [], $server, $bytes);
    }

    public function test_upload_confirmation_attachment_and_private_fixed_version_download(): void
    {
        $r = $this->postJson('/expense-documents', $this->input())->assertOk()->assertJsonPath('document.state', 'pending');
        $id = $r->json('document.id');
        $this->upload($r->json('upload'))->assertNoContent();
        $confirm = ['operationId' => (string) Str::uuid()];
        $this->postJson('/expense-documents/'.$id.'/confirm', $confirm)->assertOk()->assertJsonPath('state', 'available');
        $this->postJson('/expense-documents/'.$id.'/confirm', $confirm)->assertOk()->assertJsonPath('id', $id);
        $this->postJson('/expenses', ['operationId' => (string) Str::uuid(), 'description' => 'Electricidad del taller', 'categoryId' => '9fb97000-0000-4000-8000-000000000001', 'expenseDate' => '2026-01-01', 'amountMinor' => '150', 'method' => 'cash', 'documentId' => $id], ['Authorization' => 'Bearer synthetic-fixture'])->assertOk()->assertJsonPath('expense.document.id', $id);
        $download = $this->get('/expense-documents/'.$id.'/download')->assertOk();
        $this->get($download->json('url'), json_decode($download->json('headersJson'), true))->assertOk()->assertContent($this->bytes)->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertSame('version-1', DB::table('expense_documents')->value('object_version'));
        $this->assertSame(3, DB::table('financial_audit')->count());
    }

    public function test_no_storage_means_503_not_a_success_or_durable_rejection(): void
    {
        $this->app->instance(DocumentStorage::class, new S3DocumentStorage);
        config(['financial-ledger.document_storage_file' => null]);
        $this->postJson('/expense-documents', $this->input())->assertStatus(503)->assertJsonPath('code', 'DOCUMENT_STORAGE_UNAVAILABLE');
        $this->assertSame(0, DB::table('expense_documents')->count());
        $this->assertSame(0, DB::table('financial_operations')->count());
    }

    public function test_upload_replay_issues_fresh_grant_without_storing_secrets_in_result_or_audit(): void
    {
        $b = $this->input();
        $r = $this->postJson('/expense-documents', $b)->assertOk();
        $replay = $this->postJson('/expense-documents', $b)->assertOk()->assertJsonPath('replayed', true)->assertJsonPath('document.id', $r->json('document.id'));
        $this->assertNotSame($r->json('upload.headersJson'), $replay->json('upload.headersJson'));
        $this->postJson('/expense-documents', [...$b, 'fileName' => 'changed.png'])->assertStatus(409)->assertJsonPath('code', 'IDEMPOTENCY_CONFLICT');
        $grant = json_decode($r->json('upload.headersJson'), true)['X-Finance-Grant'];
        $this->assertSame(hash('sha256', $grant), DB::table('expense_document_grants')->first()->hash);
        foreach (['financial_operations', 'financial_audit'] as $table) {
            $record = DB::table($table)->value('record');
            $this->assertStringNotContainsString($grant, $record);
            $this->assertStringNotContainsString('headersJson', $record);
        }
        $this->get('/financial-operations/'.$b['operationId'])->assertOk()->assertJsonPath('action', 'request_document');
    }

    public function test_upload_is_hash_size_and_image_checked_and_never_overwrites(): void
    {
        $r = $this->postJson('/expense-documents', $this->input())->assertOk();
        $this->upload($r->json('upload'), 'not-a-png')->assertStatus(400)->assertJsonPath('code', 'DOCUMENT_TYPE_NOT_ALLOWED');
        $this->upload($r->json('upload'))->assertNoContent();
        $this->upload($r->json('upload'))->assertNoContent();
        $this->assertSame(1, $this->storage->puts);
        $this->assertSame('pending', DB::table('expense_documents')->value('state'));
        $this->storage->bytes = 'changed';
        $this->postJson('/expense-documents/'.$r->json('document.id').'/confirm', ['operationId' => (string) Str::uuid()])->assertStatus(400);
        $this->assertSame('pending', DB::table('expense_documents')->value('state'));
    }

    public function test_grants_are_method_record_expiry_bound_and_binary_refuses_jwt(): void
    {
        $r = $this->postJson('/expense-documents', $this->input())->assertOk();
        $target = $r->json('upload');
        $headers = json_decode($target['headersJson'], true);
        $this->get($target['url'], $headers)->assertForbidden();
        $this->put($target['url'], [], ['X-Finance-Grant' => 'bad'])->assertStatus(400);
        $this->upload($target, null, ['Authorization' => 'Bearer private'])->assertStatus(400);
        $this->get(str_replace($r->json('document.id'), (string) Str::uuid(), $target['url']), $headers)->assertForbidden();
        DB::table('expense_document_grants')->update(['expires_at' => time() - 1]);
        $this->upload($target)->assertForbidden();
    }

    public function test_metadata_owner_and_pending_confirmation_rejection_are_durable(): void
    {
        $r = $this->postJson('/expense-documents', $this->input())->assertOk();
        $id = $r->json('document.id');
        $b = ['operationId' => (string) Str::uuid()];
        $this->postJson('/expense-documents/'.$id.'/confirm', $b)->assertStatus(409)->assertJsonPath('code', 'DOCUMENT_NOT_AVAILABLE');
        $this->upload($r->json('upload'))->assertNoContent();
        $this->postJson('/expense-documents/'.$id.'/confirm', $b)->assertStatus(409)->assertJsonPath('replayed', true);
        $this->subject = 'another-owner';
        $this->postJson('/expense-documents/'.$id.'/confirm', ['operationId' => (string) Str::uuid()])->assertNotFound();
        $this->get('/expense-documents/'.$id.'/download')->assertNotFound();
        $this->assertSame('pending', DB::table('expense_documents')->value('state'));
    }

    public function test_strict_metadata_validation(): void
    {
        foreach ([['fileName' => '../a.png'], ['sizeBytes' => 5242881], ['sizeBytes' => '68'], ['sha256' => 'bad'], ['objectKey' => 'arbitrary'], ['fileName' => null]] as $override) {
            $this->postJson('/expense-documents', $this->input($override))->assertStatus(400);
        }
        $this->postJson('/expense-documents', $this->input(['contentType' => 'application/pdf']))->assertStatus(400)->assertJsonPath('code', 'DOCUMENT_TYPE_NOT_ALLOWED');
        $this->assertSame(0, DB::table('financial_operations')->count());
    }

    public function test_sql_failure_rolls_back_metadata_operation_audit_and_grant(): void
    {
        DB::statement("CREATE TRIGGER fail_document_audit BEFORE INSERT ON financial_audit BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
        $this->postJson('/expense-documents', $this->input())->assertStatus(503);
        foreach (['expense_documents', 'expense_document_grants', 'financial_operations', 'financial_audit'] as $table) { $this->assertSame(0, DB::table($table)->count()); }
    }

    public function test_s3_adapter_signs_conditional_put_and_fixed_version_read_without_forwarded_identity(): void
    {
        $profile = tempnam(sys_get_temp_dir(), 'finance-s3-test-');
        file_put_contents($profile, json_encode(['endpoint' => 'http://127.0.0.1:19000', 'region' => 'us-east-1', 'bucket' => 'finance-private', 'accessKey' => 'synthetic-test-key', 'secretKey' => 'synthetic-test-secret']));
        config(['financial-ledger.document_storage_file' => $profile]);
        Http::preventStrayRequests();
        $mime = [];
        Http::fake(function ($request) use (&$mime) {
            $this->assertStringStartsWith('AWS4-HMAC-SHA256 Credential=synthetic-test-key/', $request->header('authorization')[0]);
            $this->assertFalse($request->hasHeader('Cookie'));
            if ($request->method() === 'PUT') {
                // SigV4 signs one MIME value; merging withBody and signed headers must not duplicate it.
                $mime = array_change_key_case($request->headers(), CASE_LOWER)['content-type'] ?? [];
                $this->assertSame('*', $request->header('if-none-match')[0]);
                $this->assertSame($this->bytes, $request->body());
                return Http::response('', 200, ['x-amz-version-id' => 'fixed-version']);
            }
            $this->assertStringEndsWith('?versionId=fixed-version', $request->url());
            return Http::response($this->bytes, 200, ['x-amz-version-id' => 'fixed-version']);
        });
        try {
            $s3 = new S3DocumentStorage;
            $this->assertSame('fixed-version', $s3->put('finance/expense-documents/test', $this->bytes, 'image/png'));
            $this->assertSame(['image/png'], $mime);
            $this->assertSame($this->bytes, $s3->get('finance/expense-documents/test', 'fixed-version'));
        } finally { unlink($profile); }
    }
}

final class MemoryDocumentStorage implements DocumentStorage
{
    public string $bytes = '';
    public int $puts = 0;
    public function assertConfigured(): void {}
    public function put(string $key, string $bytes, string $contentType): string { $this->bytes = $bytes; $this->puts++; return 'version-1'; }
    public function get(string $key, string $version): string { return $this->bytes; }
}
