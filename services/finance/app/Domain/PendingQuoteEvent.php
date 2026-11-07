<?php

namespace App\Domain;

use DateTimeInterface;

final class PendingQuoteEvent
{
    public const TYPE = 'finance.quote.pending.v1';

    public static function id(string $quoteId, int $version): string
    {
        $bytes = md5(self::TYPE.'|'.strtolower($quoteId).'|'.$version, true);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x30);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return substr($hex, 0, 8).'-'.substr($hex, 8, 4).'-'.substr($hex, 12, 4).'-'.substr($hex, 16, 4).'-'.substr($hex, 20);
    }

    public static function envelope(object $quote, string $employeeId, string $scanId, DateTimeInterface $at): array
    {
        $timestamp = $at->format('Y-m-d\TH:i:s.v\Z');
        return [
            'eventId' => self::id($quote->id, (int) $quote->version_number),
            'schemaVersion' => 1,
            'eventType' => self::TYPE,
            'producer' => 'finance',
            'aggregateType' => 'quote',
            'aggregateId' => $quote->id,
            'aggregateVersion' => (int) $quote->version_number,
            'correlationId' => $quote->id,
            'causationId' => $scanId,
            'occurredAt' => $timestamp,
            'initiatedBy' => $employeeId,
            'executedBy' => 'autonexus-finance-cu28',
            'data' => [
                'quoteId' => $quote->id,
                'orderId' => $quote->order_reference,
                'status' => 'pending',
                'version' => (int) $quote->version_number,
                'pendingSince' => \Carbon\CarbonImmutable::parse($quote->created_at, 'UTC')->format('Y-m-d\TH:i:s.v\Z'),
            ],
        ];
    }
}
