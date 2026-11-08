<?php

namespace Tests\Feature;

use App\Application\Ledger\FinancialLedger;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

final class FinancialLedgerTest extends TestCase
{
    private const ORDER = '11111111-1111-4111-8111-111111111111';
    private const QUOTE = '22222222-2222-4222-8222-222222222222';
    private const SAGA = '33333333-3333-4333-8333-333333333333';
    private const LINK = '44444444-4444-4444-8444-444444444444';
    private const EMPLOYEE = '55555555-5555-4555-8555-555555555555';
    private string $temporary;
    private \OpenSSLAsymmetricKey $key;
    private string $token;
    private array $context;
    private array $grants = ['payments:read', 'payments:write', 'expenses:read', 'expenses:write'];
    private ?string $employeeStatus = 'active';
    private bool $opsDown = false;
    private bool $opsMissing = false;
    private bool $employeesDown = false;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:', 'logging.default' => 'null']);
        DB::purge('sqlite');
        (require database_path('migrations/2026_11_07_000002_create_financial_ledger.php'))->up();
        Schema::create('quotes', function (Blueprint $t) {
            $t->uuid('id')->primary(); $t->integer('version_number'); $t->string('currency'); $t->string('order_reference'); $t->string('total');
        });
        Schema::create('quote_confirmation_links', function (Blueprint $t) {
            $t->uuid('id')->primary(); $t->uuid('saga_id'); $t->uuid('quote_id'); $t->uuid('order_id'); $t->integer('quote_version'); $t->string('status');
        });
        DB::table('quotes')->insert(['id' => self::QUOTE, 'version_number' => 1, 'currency' => 'BOB', 'order_reference' => self::ORDER, 'total' => '9999999999.99']);
        DB::table('quote_confirmation_links')->insert(['id' => self::LINK, 'saga_id' => self::SAGA, 'quote_id' => self::QUOTE, 'order_id' => self::ORDER, 'quote_version' => 1, 'status' => 'active']);
        $this->context = ['orderId' => self::ORDER, 'orderNumber' => 'O-1', 'orderVersion' => 4, 'orderStatus' => 'completed', 'sagaId' => self::SAGA,
            'sagaStatus' => 'confirmed', 'quoteId' => self::QUOTE, 'quoteVersion' => 1, 'quoteLinkId' => self::LINK, 'eligibleForCollection' => true, 'reasonCode' => null, 'observedAt' => '2026-11-07T12:00:00.000Z'];
        Route::middleware('api')->group(base_path('routes/financial-ledger.php'));
        $this->temporary = sys_get_temp_dir().'/financial-ledger-'.bin2hex(random_bytes(6));
        mkdir($this->temporary.'/app', 0700, true);
        $this->app->useStoragePath($this->temporary);
        file_put_contents($this->temporary.'/openssl.cnf', "[req]\ndistinguished_name=req_dn\n[req_dn]\n");
        $this->key = openssl_pkey_new(['config' => $this->temporary.'/openssl.cnf', 'private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        $details = openssl_pkey_get_details($this->key);
        file_put_contents($this->jwks(), json_encode(['keys' => [['kid' => 'ledger', 'kty' => 'RSA', 'n' => $this->base64($details['rsa']['n']), 'e' => $this->base64($details['rsa']['e'])]]]));
        $this->token = $this->jwt();
        Http::preventStrayRequests();
        Http::fake(function ($request) {
            self::assertSame('Bearer '.$this->token, $request->header('Authorization')[0]);
            if (str_ends_with($request->url(), '/security/permissions')) {
                return Http::response(['effective' => $this->grants, 'employeeId' => $this->employeeStatus === null ? null : self::EMPLOYEE, 'employeeStatus' => $this->employeeStatus], $this->employeesDown ? 503 : 200);
            }
            return Http::response($this->context, $this->opsMissing ? 404 : ($this->opsDown ? 503 : 200));
        });
    }

    protected function tearDown(): void
    {
        unlink($this->jwks()); unlink($this->temporary.'/openssl.cnf'); rmdir($this->temporary.'/app'); rmdir($this->temporary);
        DB::disconnect('sqlite');
        parent::tearDown();
    }

    private function jwks(): string { return $this->temporary.'/app/jwks-'.hash('sha256', config('finance.issuer').'|'.config('finance.jwks_uri')).'.json'; }
    private function base64(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
    private function jwt(array $overrides = []): string
    {
        $claims = [...['sub' => 'human-ledger', 'iss' => config('finance.issuer'), 'aud' => config('finance.audience'), 'typ' => 'Bearer', 'azp' => 'autonexus-web-bff', 'exp' => time() + 60], ...$overrides];
        $msg = $this->base64(json_encode(['alg' => 'RS256', 'kid' => 'ledger'])).'.'.$this->base64(json_encode($claims));
        openssl_sign($msg, $sig, $this->key, OPENSSL_ALGO_SHA256);
        return $msg.'.'.$this->base64($sig);
    }
    private function headers(): array { return ['Authorization' => 'Bearer '.$this->token]; }
    private function payment(array $overrides = []): array { return [...['operationId' => (string) Str::uuid(), 'expectedVersion' => 0, 'amountMinor' => '999999999999', 'method' => 'cash', 'confirmReceived' => true], ...$overrides]; }
    private function pay(array $b) { return $this->postJson('/orders/'.self::ORDER.'/payments', $b, $this->headers()); }
    private function expense(array $overrides = []): array { return [...['operationId' => (string) Str::uuid(), 'description' => 'Servicio electricidad', 'categoryId' => '9fb97000-0000-4000-8000-000000000001', 'expenseDate' => '2026-01-01', 'amountMinor' => '100', 'method' => 'cash'], ...$overrides]; }

    public function test_get_projection_creates_no_money(): void
    {
        $this->get('/receivables/'.self::ORDER, $this->headers())->assertOk()->assertJsonPath('balanceVersion', 0)->assertJsonPath('agreedAmountMinor', '999999999999');
        self::assertSame(0, DB::table('financial_obligations')->count());
        self::assertSame(0, DB::table('financial_operations')->count());
    }

    public function test_missing_owner_order_is_404_and_cannot_create_money(): void
    {
        $this->opsMissing = true;
        $this->get('/receivables/'.self::ORDER, $this->headers())->assertNotFound()->assertJsonPath('code', 'OBLIGATION_NOT_FOUND');
        $body = $this->payment();
        $this->pay($body)->assertNotFound()->assertJsonPath('code', 'OBLIGATION_NOT_FOUND');
        $this->opsMissing = false;
        $this->pay($body)->assertNotFound()->assertJsonPath('replayed', true);
        self::assertSame(0, DB::table('financial_payments')->count());
        self::assertSame(0, DB::table('financial_receipts')->count());
        self::assertSame(1, DB::table('financial_operations')->count());
        self::assertSame(1, DB::table('financial_audit')->count());
    }

    public function test_unused_reference_can_be_recovered_only_for_the_same_actor_and_payment_details(): void
    {
        $path = '/orders/'.self::ORDER.'/payment-reference-verifications';
        $body = ['operationId' => (string) Str::uuid(), 'method' => 'bank_transfer', 'amountMinor' => '999999999999', 'reference' => 'recover-123', 'note' => 'Recepción comprobada por la misma persona'];
        $first = $this->postJson($path, $body, $this->headers())->assertOk()->json('verification');
        $retry = [...$body, 'operationId' => (string) Str::uuid(), 'note' => 'Solicitud para recuperar comprobación existente'];
        $this->postJson($path, $retry, $this->headers())->assertOk()->assertJsonPath('verification', fn ($v) => \App\Domain\CanonicalJson::encode($v) === \App\Domain\CanonicalJson::encode($first))->assertJsonPath('replayed', false);
        $this->postJson($path, $retry, $this->headers())->assertOk()->assertJsonPath('verification.id', $first['id'])->assertJsonPath('replayed', true);
        self::assertSame(1, DB::table('financial_verifications')->count());
        self::assertSame(0, DB::table('financial_payments')->count());
        foreach ([['method' => 'qr'], ['amountMinor' => '100']] as $different) {
            $this->postJson($path, [...$body, ...$different, 'operationId' => (string) Str::uuid()], $this->headers())->assertStatus(409)->assertJsonPath('code', 'PAYMENT_REFERENCE_ALREADY_USED');
        }
        $this->token = $this->jwt(['sub' => 'another-person']);
        $this->postJson($path, [...$body, 'operationId' => (string) Str::uuid()], $this->headers())->assertStatus(409)->assertJsonPath('code', 'PAYMENT_REFERENCE_ALREADY_USED');
        $this->token = $this->jwt();
        $otherOrder = '66666666-6666-4666-8666-666666666666';
        $this->context['orderId'] = $otherOrder;
        $this->postJson('/orders/'.$otherOrder.'/payment-reference-verifications', [...$body, 'operationId' => (string) Str::uuid()], $this->headers())->assertStatus(409)->assertJsonPath('code', 'PAYMENT_REFERENCE_ALREADY_USED');
        $this->context['orderId'] = self::ORDER;
        $this->pay($this->payment(['method' => 'bank_transfer', 'referenceVerificationId' => $first['id']]))->assertOk();
        $this->postJson($path, [...$body, 'operationId' => (string) Str::uuid()], $this->headers())->assertStatus(409)->assertJsonPath('code', 'PAYMENT_REFERENCE_ALREADY_USED');
        self::assertSame(1, DB::table('financial_verifications')->count());
        self::assertSame(1, DB::table('financial_payments')->count());
    }

    public function test_reference_verification_cannot_bind_a_nonexistent_order(): void
    {
        $this->opsMissing = true;
        $body = ['operationId' => (string) Str::uuid(), 'method' => 'bank_transfer', 'amountMinor' => '999999999999', 'reference' => 'UNKNOWN-ORDER-REFERENCE', 'note' => 'Comprobación humana sintética'];
        $path = '/orders/'.self::ORDER.'/payment-reference-verifications';
        $this->postJson($path, $body, $this->headers())->assertNotFound()->assertJsonPath('code', 'OBLIGATION_NOT_FOUND');
        $this->opsMissing = false;
        $this->postJson($path, $body, $this->headers())->assertNotFound()->assertJsonPath('replayed', true);
        self::assertSame(0, DB::table('financial_verifications')->count());
        self::assertSame(0, DB::table('financial_payments')->count());
        self::assertSame(1, DB::table('financial_operations')->count());
    }

    public function test_inconsistent_balance_fails_closed_and_preserves_prior_rows(): void
    {
        // Deliberately inconsistent history in this isolated SQLite fixture only.
        foreach (['previous-1', 'previous-2'] as $id) {
            DB::table('financial_payments')->insert(['id' => $id, 'record' => json_encode(['orderId' => self::ORDER, 'amountMinor' => '999999999999'], JSON_THROW_ON_ERROR)]);
        }
        $before = DB::table('financial_payments')->orderBy('id')->pluck('record')->all();
        $this->get('/receivables/'.self::ORDER, $this->headers())->assertStatus(409)->assertJsonPath('code', 'BALANCE_INCONSISTENT');
        $body = $this->payment();
        $this->pay($body)->assertStatus(409)->assertJsonPath('code', 'BALANCE_INCONSISTENT');
        $this->pay($body)->assertStatus(409)->assertJsonPath('replayed', true);
        self::assertSame($before, DB::table('financial_payments')->orderBy('id')->pluck('record')->all());
        self::assertSame(0, DB::table('financial_receipts')->count());
        self::assertSame(1, DB::table('financial_operations')->count());
        self::assertSame(1, DB::table('financial_audit')->count());
    }

    public function test_payment_receipt_replay_and_lookup_are_durable(): void
    {
        $b = $this->payment();
        $r = $this->pay($b)->assertOk()->assertJsonPath('receivable.balanceMinor', '0')->assertJsonPath('receivable.balanceVersion', 1)->assertJsonPath('receipt.fiscalStatus', 'internal_non_fiscal');
        $this->opsDown = true;
        $this->pay($b)->assertOk()->assertJsonPath('replayed', true)->assertJsonPath('receipt.id', $r->json('receipt.id'));
        $this->get('/payments/'.$r->json('payment.id').'/receipt', $this->headers())->assertOk()->assertJsonPath('number', $r->json('receipt.number'));
        $this->get('/financial-operations/'.$b['operationId'], $this->headers())->assertOk()->assertJsonPath('outcome', 'applied');
        foreach (['payments', 'receipts', 'audit', 'operations', 'obligations'] as $name) { self::assertSame(1, DB::table('financial_'.$name)->count()); }
    }

    public function test_changed_body_conflicts_and_business_rejection_replays(): void
    {
        $b = $this->payment(['amountMinor' => '1']);
        $this->pay($b)->assertStatus(409)->assertJsonPath('code', 'PAYMENT_PARTIAL_UNSUPPORTED');
        $this->pay($b)->assertStatus(409)->assertJsonPath('replayed', true);
        $this->pay([...$b, 'amountMinor' => '2'])->assertStatus(409)->assertJsonPath('code', 'IDEMPOTENCY_CONFLICT');
        self::assertSame(0, DB::table('financial_payments')->count());
        self::assertSame(1, DB::table('financial_audit')->count());
    }

    public function test_version_and_second_payment_are_rejected(): void
    {
        $this->pay($this->payment(['expectedVersion' => 1]))->assertStatus(409)->assertJsonPath('code', 'VERSION_CONFLICT');
        $this->pay($this->payment())->assertOk();
        $this->pay($this->payment(['expectedVersion' => 1]))->assertStatus(409)->assertJsonPath('code', 'NO_BALANCE_DUE');
        self::assertSame(1, DB::table('financial_payments')->count());
    }

    public function test_completion_saga_and_link_are_independent_requirements(): void
    {
        $this->context['orderStatus'] = 'in_progress';
        $this->pay($this->payment())->assertStatus(409)->assertJsonPath('code', 'ORDER_NOT_FINALIZED');
        $this->context['orderStatus'] = 'completed'; $this->context['sagaStatus'] = 'confirming';
        $this->pay($this->payment())->assertStatus(409)->assertJsonPath('code', 'ORDER_NOT_FINALIZED');
        $this->context['sagaStatus'] = 'confirmed'; $this->context['quoteVersion'] = 2;
        $this->pay($this->payment())->assertStatus(409)->assertJsonPath('code', 'OBLIGATION_MISMATCH');
    }

    public function test_transport_outage_is_not_a_rejected_operation(): void
    {
        $this->opsDown = true;
        $b = $this->payment();
        $this->pay($b)->assertStatus(503)->assertJsonPath('code', 'COLLECTION_CONTEXT_UNAVAILABLE');
        self::assertSame(0, DB::table('financial_operations')->count());
        $this->get('/financial-operations/'.$b['operationId'], $this->headers())->assertNotFound();
    }

    public function test_nullable_unconfirmed_context_and_malformed_transport_are_distinct(): void
    {
        $this->context['sagaId'] = null;
        $this->context['sagaStatus'] = null;
        $this->context['eligibleForCollection'] = false;
        $this->pay($this->payment())->assertStatus(409)->assertJsonPath('code', 'ORDER_NOT_FINALIZED');
        unset($this->context['observedAt']);
        $this->pay($this->payment())->assertStatus(503)->assertJsonPath('code', 'COLLECTION_CONTEXT_UNAVAILABLE');
        self::assertSame(1, DB::table('financial_operations')->count());
    }

    public function test_sql_failure_rolls_back_money_receipt_audit_and_operation(): void
    {
        DB::statement("CREATE TRIGGER fail_receipt BEFORE INSERT ON financial_receipts BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
        $this->pay($this->payment())->assertStatus(503)->assertJsonPath('code', 'PERSISTENCE_UNAVAILABLE');
        foreach (['obligations', 'payments', 'receipts', 'operations', 'audit'] as $name) { self::assertSame(0, DB::table('financial_'.$name)->count()); }
    }

    public function test_human_reference_verification_matches_actor_and_amount(): void
    {
        $this->pay($this->payment(['method' => 'qr']))->assertStatus(409)->assertJsonPath('code', 'PAYMENT_REFERENCE_UNVERIFIED');
        $v = $this->postJson('/orders/'.self::ORDER.'/payment-reference-verifications', ['operationId' => (string) Str::uuid(), 'method' => 'qr', 'amountMinor' => '999999999999', 'reference' => ' bank-123 ', 'note' => 'Comprobación humana de recepción'], $this->headers())->assertOk()->assertJsonPath('verification.reference', 'BANK-123');
        $this->pay($this->payment(['method' => 'bank_transfer', 'referenceVerificationId' => $v->json('verification.id')]))->assertStatus(409)->assertJsonPath('code', 'PAYMENT_REFERENCE_UNVERIFIED');
        $originalToken = $this->token;
        $this->token = $this->jwt(['sub' => 'another-human']);
        $this->pay($this->payment(['method' => 'qr', 'referenceVerificationId' => $v->json('verification.id')]))->assertStatus(409)->assertJsonPath('code', 'PAYMENT_REFERENCE_UNVERIFIED');
        $this->token = $originalToken;
        $this->pay($this->payment(['method' => 'qr', 'referenceVerificationId' => $v->json('verification.id')]))->assertOk();
        $this->postJson('/orders/'.self::ORDER.'/payment-reference-verifications', ['operationId' => (string) Str::uuid(), 'method' => 'qr', 'amountMinor' => '999999999999', 'reference' => 'bank-123', 'note' => 'Otro intento'], $this->headers())->assertStatus(409)->assertJsonPath('code', 'PAYMENT_REFERENCE_ALREADY_USED');
    }

    public function test_expense_duplicate_new_intent_and_period_summary(): void
    {
        $b = $this->expense();
        $r = $this->postJson('/expenses', $b, $this->headers())->assertOk();
        $this->postJson('/expenses', $b, $this->headers())->assertOk()->assertJsonPath('replayed', true);
        $this->postJson('/expenses', $this->expense(['description' => '  SERVICIO   electricidad ']), $this->headers())->assertStatus(409)->assertJsonPath('code', 'EXPENSE_POSSIBLE_DUPLICATE')->assertJsonPath('candidate.id', $r->json('expense.id'));
        $this->postJson('/expenses', $this->expense(['duplicateOf' => $r->json('expense.id'), 'duplicateReason' => 'Segundo gasto legítimo del mismo día']), $this->headers())->assertOk();
        $this->get('/financial-summary?from=2026-01-01&to=2026-12-31', $this->headers())->assertOk()->assertJsonPath('receivedAmountMinor', '0')->assertJsonPath('expenseAmountMinor', '200')->assertJsonPath('netMovementMinor', '-200');
        $this->get('/expenses', $this->headers())->assertOk()->assertJsonPath('totalAmountMinor', '200')->assertJsonPath('page.total', 2);
    }

    public function test_optional_document_without_module_fails_closed(): void
    {
        $this->postJson('/expenses', $this->expense(['documentId' => self::QUOTE]), $this->headers())->assertStatus(503)->assertJsonPath('code', 'DOCUMENT_STORAGE_UNAVAILABLE');
        self::assertSame(0, DB::table('financial_expenses')->count());
        self::assertSame(0, DB::table('financial_operations')->count());
    }

    public function test_document_is_locked_validated_and_attached_in_same_transaction(): void
    {
        Schema::create('expense_documents', function (Blueprint $t) {
            $t->uuid('id')->primary(); $t->string('owner_subject'); $t->string('state'); $t->string('sha256'); $t->string('file_name'); $t->string('content_type'); $t->integer('size_bytes'); $t->uuid('expense_id')->nullable(); $t->string('created_at');
        });
        DB::table('expense_documents')->insert(['id' => self::QUOTE, 'owner_subject' => 'another', 'state' => 'available', 'sha256' => str_repeat('a', 64), 'file_name' => 'test.png', 'content_type' => 'image/png', 'size_bytes' => 20, 'expense_id' => null, 'created_at' => '2026-01-01T00:00:00.000Z']);
        $this->postJson('/expenses', $this->expense(['documentId' => self::QUOTE]), $this->headers())->assertNotFound()->assertJsonPath('code', 'DOCUMENT_NOT_FOUND');
        DB::table('expense_documents')->update(['owner_subject' => 'human-ledger', 'state' => 'pending']);
        $this->postJson('/expenses', $this->expense(['documentId' => self::QUOTE]), $this->headers())->assertStatus(409)->assertJsonPath('code', 'DOCUMENT_NOT_AVAILABLE');
        DB::table('expense_documents')->update(['state' => 'available']);
        $r = $this->postJson('/expenses', $this->expense(['documentId' => self::QUOTE]), $this->headers())->assertOk();
        self::assertSame($r->json('expense.id'), DB::table('expense_documents')->value('expense_id'));
        $this->postJson('/expenses', $this->expense(['documentId' => self::QUOTE]), $this->headers())->assertStatus(409)->assertJsonPath('code', 'DOCUMENT_NOT_AVAILABLE');
    }

    public function test_strict_bodies_money_dates_and_queries(): void
    {
        foreach ([['amountMinor' => 100], ['amountMinor' => '01'], ['confirmReceived' => false], ['referenceVerified' => true], ['expectedVersion' => '0']] as $override) {
            $this->pay($this->payment($override))->assertStatus(400)->assertJsonPath('code', 'VALIDATION_ERROR');
        }
        $this->postJson('/expenses', $this->expense(['expenseDate' => '2026-02-30']), $this->headers())->assertStatus(400);
        $this->postJson('/expenses', $this->expense(['expenseDate' => '9999-01-01']), $this->headers())->assertStatus(400);
        $this->get('/payments?extra=1', $this->headers())->assertStatus(400);
        self::assertSame(0, DB::table('financial_operations')->count());
    }

    public function test_fresh_employee_and_grants_are_checked_on_every_call(): void
    {
        $this->get('/expense-categories', $this->headers())->assertOk()->assertJsonCount(5);
        $this->grants = [];
        $this->get('/expense-categories', $this->headers())->assertForbidden();
        $this->grants = ['expenses:read']; $this->employeeStatus = 'inactive';
        $this->get('/expense-categories', $this->headers())->assertForbidden();
        $this->employeeStatus = null;
        $this->get('/expense-categories', $this->headers())->assertForbidden();
        $this->employeesDown = true;
        $this->get('/expense-categories', $this->headers())->assertStatus(503);
    }

    public function test_authentication_audience_expiry_and_technical_boundaries(): void
    {
        $this->get('/expense-categories')->assertUnauthorized();
        $this->get('/expense-categories', ['Authorization' => 'Bearer '.$this->jwt(['aud' => 'other'])])->assertUnauthorized();
        $this->get('/expense-categories', ['Authorization' => 'Bearer '.$this->jwt(['exp' => time() - 60])])->assertUnauthorized();
        $this->get('/expense-categories', ['Authorization' => 'Bearer '.$this->jwt(['azp' => 'autonexus-cu15-coordinator'])])->assertForbidden();
    }

    public function test_operation_lookup_requires_module_read_or_original_writer(): void
    {
        $b = $this->expense();
        $this->postJson('/expenses', $b, $this->headers())->assertOk();
        $this->grants = ['payments:read'];
        $this->get('/financial-operations/'.$b['operationId'], $this->headers())->assertForbidden();
        $this->grants = ['expenses:write'];
        $this->get('/financial-operations/'.$b['operationId'], $this->headers())->assertOk();
    }

    public function test_document_routes_require_fresh_module_permissions_and_employee(): void
    {
        $body = ['operationId' => (string) Str::uuid(), 'fileName' => 'fixture.png', 'contentType' => 'image/png', 'sizeBytes' => 68, 'sha256' => str_repeat('a', 64)];
        $this->postJson('/expense-documents', $body)->assertUnauthorized();
        $this->grants = ['payments:write'];
        $this->postJson('/expense-documents', $body, $this->headers())->assertForbidden();
        $this->grants = ['expenses:write'];
        $this->employeeStatus = 'inactive';
        $this->postJson('/expense-documents', $body, $this->headers())->assertForbidden();
        $this->employeeStatus = 'active';
        $this->employeesDown = true;
        $this->postJson('/expense-documents', $body, $this->headers())->assertStatus(503);
        $this->employeesDown = false;
        $this->get('/expense-documents/'.self::QUOTE.'/download', $this->headers())->assertForbidden();
        $this->grants = ['expenses:read'];
        $this->postJson('/expense-documents/'.self::QUOTE.'/confirm', ['operationId' => (string) Str::uuid()], $this->headers())->assertForbidden();
        self::assertSame(0, DB::table('financial_operations')->count());
    }
}
