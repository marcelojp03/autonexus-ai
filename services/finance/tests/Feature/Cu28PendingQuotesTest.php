<?php

namespace Tests\Feature;

use App\Application\Cu28\PendingQuotes;
use App\Domain\PendingQuoteEvent;
use App\Infrastructure\Cu28\PendingQuotePublisher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

final class Cu28PendingQuotesTest extends TestCase
{
    private string $directory;
    private \OpenSSLAsymmetricKey $key;
    private const EMPLOYEE = '11111111-1111-4111-8111-111111111111';
    private const PATH = '/automations/quotes/pending';

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => ':memory:',
            'database.connections.sqlite.url' => null, 'cache.default' => 'array', 'logging.default' => 'null',
            'cu28.pending_quote_hours' => 24, 'cu28.webhook_url' => 'http://localhost/cu28', 'cu28.webhook_secret' => 'test-only']);
        DB::purge('sqlite');
        (require database_path('migrations/2026_10_28_000001_create_quotes.php'))->up();
        (require database_path('migrations/2026_11_07_000001_create_cu28_outbox.php'))->up();
        Schema::create('quote_confirmation_links', fn ($table) => $table->uuid('quote_id'));
        DB::connection()->getPdo()->sqliteCreateFunction('hashtextextended', fn ($value, $seed) => 0, 2);
        DB::connection()->getPdo()->sqliteCreateFunction('pg_advisory_xact_lock', fn ($value) => 0, 1);
        $this->directory = sys_get_temp_dir().'/finance-cu28-'.bin2hex(random_bytes(6));
        mkdir($this->directory.'/app', 0700, true);
        $this->app->useStoragePath($this->directory);
        file_put_contents($this->directory.'/openssl.cnf', "[req]\ndistinguished_name = dn\n[dn]\n");
        $this->key = openssl_pkey_new(['config' => $this->directory.'/openssl.cnf', 'private_key_bits' => 2048]);
        $details = openssl_pkey_get_details($this->key);
        file_put_contents($this->jwks(), json_encode(['keys' => [[
            'kid' => 'cu28-test', 'kty' => 'RSA', 'n' => $this->b64($details['rsa']['n']), 'e' => $this->b64($details['rsa']['e']),
        ]]]));
        $this->authorization();
        Http::preventStrayRequests();
    }

    protected function tearDown(): void
    {
        $this->travelBack();
        unlink($this->jwks());
        unlink($this->directory.'/openssl.cnf');
        rmdir($this->directory.'/app');
        rmdir($this->directory);
        DB::disconnect('sqlite');
        parent::tearDown();
    }

    private function jwks(): string
    {
        return $this->directory.'/app/jwks-'.hash('sha256', config('finance.issuer').'|'.config('finance.jwks_uri')).'.json';
    }

    private function b64(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }

    private function token(array $overrides = []): string
    {
        $claims = [...['sub' => 'human-cu28', 'iss' => config('finance.issuer'), 'aud' => config('finance.audience'),
            'typ' => 'Bearer', 'azp' => 'autonexus-web', 'exp' => time() + 3600,
            'realm_access' => ['roles' => ['responsable_financiero']]], ...$overrides];
        $message = $this->b64(json_encode(['alg' => 'RS256', 'kid' => 'cu28-test'])).'.'.$this->b64(json_encode($claims));
        openssl_sign($message, $signature, $this->key, OPENSSL_ALGO_SHA256);
        return $message.'.'.$this->b64($signature);
    }

    private function authorization(?array $actor = ['employeeId' => self::EMPLOYEE, 'status' => 'active'], array $effective = ['quotes:read', 'quotes:decide']): void
    {
        Cache::flush();
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::fake([
            rtrim(config('finance.employees_url'), '/').'/security/permissions' => Http::response(['effective' => $effective, 'employeeId' => $actor['employeeId'] ?? null, 'employeeStatus' => $actor['status'] ?? null]),
            config('cu28.webhook_url') => Http::response([], 200),
        ]);
    }

    private function quote(string $status = 'pending', float $hours = 25, int $version = 1): string
    {
        $id = (string) Str::uuid();
        DB::table('quotes')->insert([
            'id' => $id, 'order_reference' => (string) Str::uuid(), 'order_number' => 'TEST',
            'customer_reference' => 'private-customer', 'vehicle_reference' => 'private-vehicle', 'vehicle_plate' => 'PRIVATE',
            'version_number' => $version, 'status' => $status, 'subtotal' => 100, 'discount_percent' => 0,
            'discount_amount' => 0, 'tax_percent' => 0, 'tax_amount' => 0, 'total' => 100, 'currency' => 'BOB',
            'notes' => 'private note', 'valid_until' => now()->addDays(10)->toDateString(), 'created_by' => 'human-cu28',
            'created_at' => now('UTC')->subSeconds(round($hours * 3600)), 'updated_at' => now('UTC'),
        ]);
        return $id;
    }

    public function test_authentication_and_fresh_active_binding_are_required(): void
    {
        $this->postJson(self::PATH)->assertUnauthorized();
        $this->withToken($this->token(['exp' => time() - 60]))->postJson(self::PATH)->assertUnauthorized();
        $this->withToken($this->token(['azp' => 'autonexus-cu15-coordinator']))->postJson(self::PATH)->assertForbidden();
        $this->authorization(effective: []);
        $this->withToken($this->token())->postJson(self::PATH)->assertForbidden();
        $this->authorization(actor: null);
        $this->postJson(self::PATH)->assertForbidden();
        $this->authorization(actor: ['employeeId' => self::EMPLOYEE, 'status' => 'inactive']);
        $this->postJson(self::PATH)->assertForbidden();
        $this->assertDatabaseCount('cu28_outbox', 0);
    }

    public function test_pending_threshold_and_replay_keep_one_closed_durable_event(): void
    {
        $this->freezeTime();
        $id = $this->quote();
        foreach (['approved', 'rejected', 'superseded', 'expired'] as $state) $this->quote($state);
        $this->quote(hours: 23);
        $this->quote(hours: 24);
        $this->withToken($this->token());
        $first = $this->postJson(self::PATH)->assertOk()->assertJsonCount(1, 'events')->json();
        $this->assertSame(['eventId' => PendingQuoteEvent::id($id, 1), 'aggregateId' => $id, 'aggregateVersion' => 1], $first['events'][0]);
        $payload = DB::table('cu28_outbox')->value('payload');
        $this->postJson(self::PATH)->assertOk()->assertExactJson($first);
        $this->assertDatabaseCount('cu28_outbox', 1);
        $this->assertSame($payload, DB::table('cu28_outbox')->value('payload'));
        $envelope = json_decode($payload, true);
        $this->assertSame(['eventId', 'schemaVersion', 'eventType', 'producer', 'aggregateType', 'aggregateId', 'aggregateVersion', 'correlationId', 'causationId', 'occurredAt', 'initiatedBy', 'executedBy', 'data'], array_keys($envelope));
        $this->assertSame(['quoteId', 'orderId', 'status', 'version', 'pendingSince'], array_keys($envelope['data']));
        $this->assertStringNotContainsString('private', $payload);
        $this->postJson(self::PATH, ['thresholdHours' => 0])->assertBadRequest();
        $this->postJson(self::PATH.'?now=tomorrow')->assertBadRequest();
    }

    public function test_server_threshold_is_configurable_and_versions_have_distinct_ids(): void
    {
        config(['cu28.pending_quote_hours' => 48]);
        $this->quote(hours: 25);
        $id = $this->quote(hours: 49, version: 2);
        $events = app(PendingQuotes::class)->collect(self::EMPLOYEE);
        $this->assertCount(1, $events);
        $this->assertSame(PendingQuoteEvent::id($id, 2), $events[0]['eventId']);
        $this->assertNotSame(PendingQuoteEvent::id($id, 1), $events[0]['eventId']);
    }

    public function test_one_minute_threshold_collects_old_pending_but_excludes_fresh_quotes(): void
    {
        config(['cu28.pending_quote_hours' => '0.016666666666666666']);
        $id = $this->quote(hours: 2 / 60);
        $this->quote(hours: 0);
        $this->quote(status: 'approved', hours: 2 / 60);

        $events = app(PendingQuotes::class)->collect(self::EMPLOYEE);

        $this->assertCount(1, $events);
        $this->assertSame($id, $events[0]['aggregateId']);
        $this->assertDatabaseCount('cu28_outbox', 1);
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('invalidThresholds')]
    public function test_invalid_threshold_is_rejected(mixed $hours): void
    {
        config(['cu28.pending_quote_hours' => $hours]);
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid configuration: CU28_PENDING_QUOTE_HOURS');

        app(PendingQuotes::class)->collect(self::EMPLOYEE);
    }

    public static function invalidThresholds(): array
    {
        return [[0], [-1], [1 / 120], [8761], [INF], [NAN], ['invalid']];
    }

    public function test_decision_after_scan_suppresses_notice_without_delivery(): void
    {
        $id = $this->quote();
        app(PendingQuotes::class)->collect(self::EMPLOYEE);
        $this->withToken($this->token())->postJson('/quotes/'.$id.'/decision', [
            'operationId' => (string) Str::uuid(), 'decision' => 'approved', 'evidence' => 'test authorization',
        ])->assertOk();
        app(PendingQuotePublisher::class)->deliverNext();
        $row = DB::table('cu28_outbox')->first();
        $this->assertNotNull($row->suppressed_at);
        $this->assertNull($row->delivered_at);
        $this->assertSame('CU28_QUOTE_STALE', $row->last_error_code);
        Http::assertNotSent(fn ($request) => $request->url() === config('cu28.webhook_url'));
    }

    public function test_version_change_and_missing_quote_suppress_notice(): void
    {
        $id = $this->quote();
        app(PendingQuotes::class)->collect(self::EMPLOYEE);
        DB::table('quotes')->where('id', $id)->update(['version_number' => 2]);
        app(PendingQuotePublisher::class)->deliverNext();
        $this->assertDatabaseHas('cu28_outbox', ['quote_id' => $id, 'last_error_code' => 'CU28_QUOTE_STALE', 'delivered_at' => null]);
        DB::table('quotes')->where('id', $id)->update(['status' => 'approved']);
        $id = $this->quote();
        app(PendingQuotes::class)->collect(self::EMPLOYEE);
        DB::table('quotes')->where('id', $id)->delete();
        app(PendingQuotePublisher::class)->deliverNext();
        $this->assertDatabaseHas('cu28_outbox', ['quote_id' => $id, 'last_error_code' => 'CU28_QUOTE_STALE', 'delivered_at' => null]);
    }

    public function test_failure_retains_same_event_and_backoff_then_delivery_requires_success(): void
    {
        $this->freezeTime();
        $this->quote();
        $event = app(PendingQuotes::class)->collect(self::EMPLOYEE)[0];
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::fake([config('cu28.webhook_url') => Http::sequence()->push([], 503)->push([], 200)]);
        $publisher = app(PendingQuotePublisher::class);
        $this->assertSame($event['eventId'], $publisher->deliverNext());
        $row = DB::table('cu28_outbox')->first();
        $this->assertNull($row->delivered_at);
        $this->assertNull($row->lease_owner);
        $this->assertSame('CU28_WEBHOOK_HTTP_503', $row->last_error_code);
        $this->assertSame(1, $row->attempts);
        $this->assertNull($publisher->deliverNext());
        $this->travel(2)->seconds();
        $this->assertSame($event['eventId'], $publisher->deliverNext());
        $this->assertNotNull(DB::table('cu28_outbox')->value('delivered_at'));
        $this->assertDatabaseCount('cu28_outbox', 1);
        Http::assertSent(fn ($request) => $request->hasHeader('x-autonexus-secret', 'test-only')
            && $request['eventId'] === $event['eventId'] && $request->toPsrRequest()->getProtocolVersion() === '1.1');
        $this->assertNull($publisher->deliverNext());
    }

    public function test_lease_and_retry_cap_preserve_undelivered_rows(): void
    {
        $this->freezeTime();
        $this->quote();
        app(PendingQuotes::class)->collect(self::EMPLOYEE);
        DB::table('cu28_outbox')->update(['lease_owner' => (string) Str::uuid(), 'lease_until' => now()->addSeconds(30)]);
        $publisher = app(PendingQuotePublisher::class);
        $this->assertNull($publisher->deliverNext());
        $this->travel(31)->seconds();
        DB::table('cu28_outbox')->update(['attempts' => 9]);
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::fake([config('cu28.webhook_url') => Http::response([], 503)]);
        $publisher->deliverNext();
        $row = DB::table('cu28_outbox')->first();
        $this->assertSame(10, $row->attempts);
        $this->assertNotNull($row->abandoned_at);
        $this->assertNull($row->delivered_at);
        $this->assertSame('CU28_DELIVERY_ATTEMPTS_EXHAUSTED', $row->last_error_code);
        $this->assertNull($publisher->deliverNext());
        $this->assertDatabaseCount('cu28_outbox', 1);
    }

    public function test_command_requires_one_mode_and_webhook_configuration(): void
    {
        $this->artisan('cu28:publish-outbox')->assertExitCode(2);
        $this->artisan('cu28:publish-outbox', ['--once' => true, '--loop' => true])->assertExitCode(2);
        config(['cu28.webhook_url' => '']);
        $this->artisan('cu28:publish-outbox', ['--once' => true])->assertExitCode(1);
        config(['cu28.webhook_url' => 'http://localhost/cu28', 'cu28.webhook_secret' => '']);
        $this->artisan('cu28:publish-outbox', ['--once' => true])->assertExitCode(2);
    }
}
