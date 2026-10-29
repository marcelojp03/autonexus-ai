<?php

namespace Tests\Unit;

use App\Application\Cu15\QuoteLinks;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\TestCase;
use App\Application\Cu15\ProtocolError;
use Tests\Support\InMemoryQuoteLinkStore;

final class Cu15LedgerTest extends TestCase
{
    private InMemoryQuoteLinkStore $store;
    private QuoteLinks $service;
    private const SAGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    private const QUOTE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    private const ORDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    protected function setUp(): void
    {
        CarbonImmutable::setTestNow('2026-10-29T03:59:59Z');
        $this->store = new InMemoryQuoteLinkStore();
        $this->service = new QuoteLinks($this->store);
        $this->store->quotes[self::QUOTE] = ['version_number' => 2, 'order_reference' => self::ORDER, 'status' => 'approved', 'valid_until' => '2026-10-28'];
        $this->store->approvals[self::QUOTE] = ['decision' => 'approved', 'id' => 'decision-reference'];
    }

    protected function tearDown(): void { CarbonImmutable::setTestNow(); }

    private function body(string $operation = '11111111-1111-4111-8111-111111111111'): array
    {
        return ['operationId' => $operation, 'expectedVersion' => 0, 'initiatedBy' => 'human-subject',
            'authorizedAt' => '2026-10-28T12:00:00.000Z', 'orderId' => self::ORDER, 'quoteId' => self::QUOTE, 'quoteVersion' => 2];
    }

    private function cancelBody(int $version = 1): array
    {
        return ['operationId' => '22222222-2222-4222-8222-222222222222', 'expectedVersion' => $version,
            'initiatedBy' => 'human-subject', 'authorizedAt' => '2026-10-28T12:00:00.000Z', 'reasonCode' => 'SAGA_REJECTED'];
    }

    public function test_replay_is_historical_after_cancel_and_does_not_reactivate(): void
    {
        $first = $this->service->execute('authorize_quote', self::SAGA, $this->body());
        $this->assertSame('active', $first['resource']['status']);
        CarbonImmutable::setTestNow('2026-11-30T12:00:00Z');
        $cancel = $this->service->execute('cancel_quote_link', self::SAGA, $this->cancelBody());
        $this->assertSame('cancelled', $cancel['resource']['status']);
        $replay = $this->service->execute('authorize_quote', self::SAGA, array_reverse($this->body(), true));
        $this->assertTrue($replay['replayed']);
        $this->assertSame($first['resource'], $replay['resource']);
        $this->assertSame('cancelled', $this->service->link(self::SAGA)['status']);
        $this->assertSame('approved', $this->store->quotes[self::QUOTE]['status']);
        $this->assertCount(2, $this->store->events);
    }

    public function test_cancel_before_authorize_leaves_terminal_tombstone(): void
    {
        $cancel = $this->service->execute('cancel_quote_link', self::SAGA, $this->cancelBody(0));
        $this->assertTrue($cancel['resource']['tombstone']);
        $result = $this->service->execute('authorize_quote', self::SAGA, $this->body());
        $this->assertSame('rejected', $result['outcome']);
        $this->assertSame('QUOTE_LINK_CANCELLED', $result['errorCode']);
        $this->assertNull($result['resource']);
        $this->assertSame($result, $this->service->operation($result['operationId']));
    }

    public function test_same_operation_with_different_body_is_conflict_not_durable_rejection(): void
    {
        $this->service->execute('authorize_quote', self::SAGA, $this->body());
        try {
            $this->service->execute('authorize_quote', self::SAGA, [...$this->body(), 'quoteVersion' => 3]);
            $this->fail('Expected conflict');
        } catch (ProtocolError $error) {
            $this->assertSame('IDEMPOTENCY_CONFLICT', $error->getMessage());
        }
        $this->assertCount(1, $this->store->operations);
        $this->assertCount(1, $this->store->events);
    }

    public function test_cancel_reason_participates_in_fingerprint(): void
    {
        $this->service->execute('cancel_quote_link', self::SAGA, $this->cancelBody(0));
        $this->expectExceptionMessage('IDEMPOTENCY_CONFLICT');
        $this->service->execute('cancel_quote_link', self::SAGA, [...$this->cancelBody(0), 'reasonCode' => 'OTHER_REASON']);
    }

    public function test_cancel_replay_is_stable_and_new_command_does_not_rewrite_terminal_state(): void
    {
        $first = $this->service->execute('cancel_quote_link', self::SAGA, $this->cancelBody(0));
        $replay = $this->service->execute('cancel_quote_link', self::SAGA, $this->cancelBody(0));
        $this->assertSame($first['resource'], $replay['resource']);
        $this->assertCount(1, $this->store->events);
        $next = $this->service->execute('cancel_quote_link', self::SAGA, [
            ...$this->cancelBody(1), 'operationId' => '33333333-3333-4333-8333-333333333333',
        ]);
        $this->assertSame('QUOTE_LINK_CANCELLED', $next['errorCode']);
        $this->assertSame($first['resource'], $this->service->link(self::SAGA));
    }

    public function test_rejection_is_durable_and_replay_does_not_revalidate_new_state(): void
    {
        unset($this->store->approvals[self::QUOTE]);
        $first = $this->service->execute('authorize_quote', self::SAGA, $this->body());
        $this->assertSame('QUOTE_APPROVAL_MISSING', $first['errorCode']);
        $this->store->approvals[self::QUOTE] = ['decision' => 'approved'];
        $replay = $this->service->execute('authorize_quote', self::SAGA, $this->body());
        $this->assertSame($first['errorCode'], $replay['errorCode']);
        $this->assertTrue($replay['replayed']);
        $this->assertCount(1, $this->store->audits);
        $this->assertCount(0, $this->store->links);
    }

    public function test_another_saga_cannot_link_an_occupied_order(): void
    {
        $this->service->execute('authorize_quote', self::SAGA, $this->body());
        $result = $this->service->execute('authorize_quote', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', $this->body('33333333-3333-4333-8333-333333333333'));
        $this->assertSame('QUOTE_ALREADY_LINKED', $result['errorCode']);
        $this->assertCount(1, $this->store->links);
    }

    public function test_wrong_cancel_version_rejects_without_changing_link(): void
    {
        $this->service->execute('authorize_quote', self::SAGA, $this->body());
        $result = $this->service->execute('cancel_quote_link', self::SAGA, $this->cancelBody(0));
        $this->assertSame('VERSION_CONFLICT', $result['errorCode']);
        $this->assertSame('active', $this->service->link(self::SAGA)['status']);
    }

    public function test_storage_failure_rolls_back_and_is_not_a_business_rejection(): void
    {
        $this->store->failCommit = true;
        try {
            $this->service->execute('authorize_quote', self::SAGA, $this->body());
            $this->fail('Expected storage failure');
        } catch (\RuntimeException $error) {
            $this->assertSame('injected-storage-failure', $error->getMessage());
        }
        $this->assertSame([], $this->store->links);
        $this->assertSame([], $this->store->operations);
    }

    public function test_unknown_operation_is_404_not_rejected(): void
    {
        try {
            $this->service->operation('unknown');
            $this->fail('Expected unknown operation');
        } catch (ProtocolError $error) {
            $this->assertSame('OPERATION_NOT_FOUND', $error->getMessage());
        }
    }
}
