<?php

namespace Tests\Unit;

use App\Domain\QuoteLinkPolicy;
use PHPUnit\Framework\TestCase;

final class Cu15QuoteLinkPolicyTest extends TestCase
{
    public function test_all_financial_authorization_invariants(): void
    {
        $quote = ['version_number' => 2, 'order_reference' => 'order', 'status' => 'approved', 'valid_until' => '2026-10-28'];
        $approval = ['decision' => 'approved'];
        $body = ['quoteVersion' => 2, 'orderId' => 'order'];
        $now = new \DateTimeImmutable('2026-10-29T03:59:59.999Z');
        $this->assertNull(QuoteLinkPolicy::authorize($quote, $approval, null, $body, false, $now));
        $cases = [
            [null, $approval, null, $body, false, 'QUOTE_NOT_FOUND'],
            [[...$quote, 'status' => 'pending'], $approval, null, $body, false, 'QUOTE_NOT_APPROVED'],
            [$quote, null, null, $body, false, 'QUOTE_APPROVAL_MISSING'],
            [$quote, ['decision' => 'rejected'], null, $body, false, 'QUOTE_APPROVAL_MISSING'],
            [$quote, $approval, null, [...$body, 'quoteVersion' => 1], false, 'VERSION_CONFLICT'],
            [$quote, $approval, null, [...$body, 'orderId' => 'other'], false, 'QUOTE_ORDER_MISMATCH'],
            [[...$quote, 'valid_until' => '2026-10-27'], $approval, null, $body, false, 'QUOTE_EXPIRED'],
            [$quote, $approval, null, $body, true, 'QUOTE_ALREADY_LINKED'],
            [$quote, $approval, ['status' => 'cancelled'], $body, false, 'QUOTE_LINK_CANCELLED'],
        ];
        foreach ($cases as [$q, $a, $link, $input, $occupied, $expected]) {
            $this->assertSame($expected, QuoteLinkPolicy::authorize($q, $a, $link, $input, $occupied, $now));
        }
    }
}
