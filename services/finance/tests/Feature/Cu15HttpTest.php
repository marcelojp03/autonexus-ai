<?php

namespace Tests\Feature;

use App\Application\Cu15\QuoteLinkStore;
use Tests\Support\InMemoryQuoteLinkStore;
use Tests\TestCase;

final class Cu15HttpTest extends TestCase
{
    private string $temporaryStorage;
    private \OpenSSLAsymmetricKey $privateKey;
    private InMemoryQuoteLinkStore $store;
    private const SAGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const OP = '11111111-1111-4111-8111-111111111111';

    protected function setUp(): void
    {
        parent::setUp();
        $this->temporaryStorage = sys_get_temp_dir().'/finance-cu15-'.bin2hex(random_bytes(8));
        mkdir($this->temporaryStorage.'/app', 0700, true);
        $this->app->useStoragePath($this->temporaryStorage);
        $this->app['config']->set('logging.default', 'null');
        file_put_contents($this->temporaryStorage.'/openssl.cnf', "[req]\ndistinguished_name = req_distinguished_name\n[req_distinguished_name]\n");
        $this->privateKey = openssl_pkey_new(['config' => $this->temporaryStorage.'/openssl.cnf', 'private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        $details = openssl_pkey_get_details($this->privateKey);
        file_put_contents($this->temporaryStorage.'/app/jwks.json', json_encode(['keys' => [[
            'kid' => 'test-key', 'kty' => 'RSA', 'n' => $this->base64($details['rsa']['n']), 'e' => $this->base64($details['rsa']['e']),
        ]]]));
        $this->store = new InMemoryQuoteLinkStore();
        $this->app->instance(QuoteLinkStore::class, $this->store);
    }

    protected function tearDown(): void
    {
        if (is_file($this->temporaryStorage.'/app/jwks.json')) {
            unlink($this->temporaryStorage.'/app/jwks.json');
        }
        unlink($this->temporaryStorage.'/openssl.cnf');
        rmdir($this->temporaryStorage.'/app');
        rmdir($this->temporaryStorage);
        parent::tearDown();
    }

    private function base64(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }

    private function token(array $overrides = []): string
    {
        $claims = [...[
            'sub' => 'technical-subject', 'iss' => config('finance.issuer'), 'aud' => config('finance.audience'),
            'exp' => time() + 60, 'typ' => 'Bearer', 'azp' => 'autonexus-cu15-coordinator',
            'scope' => 'cu15.finance.read cu15.finance.authorize cu15.finance.cancel',
        ], ...$overrides];
        $message = $this->base64(json_encode(['alg' => 'RS256', 'kid' => 'test-key'])).'.'.$this->base64(json_encode($claims));
        openssl_sign($message, $signature, $this->privateKey, OPENSSL_ALGO_SHA256);
        return $message.'.'.$this->base64($signature);
    }

    private function body(): array
    {
        return ['operationId' => self::OP, 'expectedVersion' => 0, 'initiatedBy' => 'human-subject',
            'authorizedAt' => '2026-10-28T08:00:00-04:00', 'orderId' => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            'quoteId' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'quoteVersion' => 1];
    }

    public function test_internal_routes_require_token_own_audience_client_and_exact_scope(): void
    {
        $path = '/internal/cu15/operations/'.self::OP;
        $this->getJson($path)->assertUnauthorized();
        $this->withToken($this->token(['aud' => 'another-api']))->getJson($path)->assertUnauthorized();
        $this->withToken($this->token(['exp' => time() - 60]))->getJson($path)->assertUnauthorized();
        $this->withToken('invalid.signature.token')->getJson($path)->assertUnauthorized();
        $this->withToken($this->token(['azp' => 'autonexus-web', 'realm_access' => ['roles' => ['administrador']]]))->getJson($path)->assertForbidden();
        $this->withToken($this->token(['scope' => 'quotes:read']))->getJson($path)->assertForbidden();
        $this->withToken($this->token(['scope' => 'cu15.finance.read']))->postJson('/internal/cu15/quote-links/'.self::SAGA.'/authorize', $this->body())->assertForbidden();
        $this->withToken($this->token())->getJson($path)->assertNotFound()->assertJsonPath('code', 'OPERATION_NOT_FOUND');
        $this->assertSame([], $this->store->operations);
    }

    public function test_technical_token_cannot_access_human_quotes_even_with_human_roles(): void
    {
        $this->withToken($this->token(['realm_access' => ['roles' => ['administrador']]]))->getJson('/quotes')->assertForbidden();
    }

    public function test_rejection_envelope_is_durable_replayable_and_conflict_is_not_rejected(): void
    {
        $path = '/internal/cu15/quote-links/'.self::SAGA.'/authorize';
        $this->withToken($this->token());
        $first = $this->postJson($path, $this->body())->assertConflict()
            ->assertJsonPath('outcome', 'rejected')->assertJsonPath('command', 'authorize_quote')
            ->assertJsonPath('errorCode', 'QUOTE_NOT_FOUND')->assertJsonPath('replayed', false)->json();
        $this->assertSame(['operationId', 'sagaId', 'command', 'fingerprint', 'outcome', 'resource', 'errorCode', 'committedAt', 'replayed'], array_keys($first));
        $this->postJson($path, array_reverse($this->body(), true))->assertConflict()->assertJsonPath('replayed', true)->assertJsonPath('fingerprint', $first['fingerprint']);
        $normalized = [...$this->body(), 'quoteId' => strtoupper($this->body()['quoteId']), 'orderId' => strtoupper($this->body()['orderId']), 'authorizedAt' => '2026-10-28T12:00:00.000Z'];
        $this->postJson('/internal/cu15/quote-links/'.strtoupper(self::SAGA).'/authorize', $normalized)
            ->assertConflict()->assertJsonPath('replayed', true)->assertJsonPath('fingerprint', $first['fingerprint']);
        $this->getJson('/internal/cu15/operations/'.self::OP)->assertOk()->assertJsonPath('replayed', false)->assertJsonPath('outcome', 'rejected');
        $this->postJson($path, [...$this->body(), 'quoteVersion' => 2])->assertConflict()->assertJsonPath('code', 'IDEMPOTENCY_CONFLICT')->assertJsonMissingPath('outcome');
        $this->assertCount(1, $this->store->operations);
    }

    public function test_invalid_body_does_not_create_ledger_and_terminal_marker_has_no_fake_id(): void
    {
        $path = '/internal/cu15/quote-links/'.self::SAGA;
        $this->withToken($this->token());
        foreach ([['expectedVersion' => '0'], ['quoteVersion' => 1.5], ['unexpected' => true], ['authorizedAt' => 'tomorrow'], ['expectedVersion' => 1]] as $changes) {
            $this->postJson($path.'/authorize', [...$this->body(), ...$changes])->assertBadRequest();
        }
        $this->assertSame([], $this->store->operations);
        $cancel = array_intersect_key($this->body(), array_flip(['operationId', 'expectedVersion', 'initiatedBy', 'authorizedAt']));
        $this->postJson($path.'/cancel', [...$cancel, 'reasonCode' => 'SAGA_REJECTED'])->assertOk()
            ->assertJsonPath('command', 'cancel_quote_link')->assertJsonPath('resource.tombstone', true)->assertJsonMissingPath('resource.id');
        $this->getJson($path)->assertOk()->assertExactJson(['sagaId' => self::SAGA, 'status' => 'cancelled', 'version' => 1, 'tombstone' => true]);
    }

    public function test_publisher_is_disabled_by_default_and_requires_explicit_mode(): void
    {
        config(['cu15.messaging_enabled' => false]);
        $this->artisan('cu15:publish-outbox', ['--once' => true])->expectsOutput('CU15 messaging is disabled.')->assertExitCode(1);
        $this->artisan('cu15:publish-outbox', ['--once' => true, '--loop' => true])->expectsOutput('Choose --once or --loop.')->assertExitCode(2);
    }
}
