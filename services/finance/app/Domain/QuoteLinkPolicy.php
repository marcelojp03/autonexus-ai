<?php

namespace App\Domain;

use DateTimeInterface;

final class QuoteLinkPolicy
{
    public static function authorize(?array $quote, ?array $approval, ?array $link, array $body, bool $occupied, DateTimeInterface $now): ?string
    {
        if ($link !== null) {
            return $link['status'] === 'cancelled' ? 'QUOTE_LINK_CANCELLED' : 'QUOTE_ALREADY_LINKED';
        }
        if ($quote === null) {
            return 'QUOTE_NOT_FOUND';
        }
        if ((int) $quote['version_number'] !== $body['quoteVersion']) {
            return 'VERSION_CONFLICT';
        }
        if (strtolower($quote['order_reference']) !== $body['orderId']) {
            return 'QUOTE_ORDER_MISMATCH';
        }
        if ($quote['status'] !== 'approved') {
            return 'QUOTE_NOT_APPROVED';
        }
        if ($approval === null || $approval['decision'] !== 'approved') {
            return 'QUOTE_APPROVAL_MISSING';
        }
        if (!CivilQuoteCalendar::current($quote['valid_until'], $now)) {
            return 'QUOTE_EXPIRED';
        }
        return $occupied ? 'QUOTE_ALREADY_LINKED' : null;
    }

    public static function cancel(?array $link, int $expectedVersion): ?string
    {
        if ($expectedVersion !== ($link === null ? 0 : (int) $link['version'])) {
            return 'VERSION_CONFLICT';
        }
        return ($link['status'] ?? null) === 'cancelled' ? 'QUOTE_LINK_CANCELLED' : null;
    }
}
