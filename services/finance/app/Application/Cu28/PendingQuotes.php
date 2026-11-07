<?php

namespace App\Application\Cu28;

use App\Domain\PendingQuoteEvent;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;

final class PendingQuotes
{
    public function collect(string $employeeId): array
    {
        $hours = filter_var(config('cu28.pending_quote_hours'), FILTER_VALIDATE_FLOAT);
        if ($hours === false || !is_finite($hours) || $hours < 1 / 60 || $hours > 8760) {
            throw new InvalidArgumentException('Invalid configuration: CU28_PENDING_QUOTE_HOURS');
        }
        $cutoff = now('UTC')->subSeconds(round($hours * 3600));
        $scanId = (string) Str::uuid();
        $events = [];
        $ids = DB::table('quotes')->where('status', 'pending')->where('created_at', '<', $cutoff)->orderBy('id')->pluck('id');
        foreach ($ids as $id) {
            $event = DB::transaction(function () use ($id, $cutoff, $scanId, $employeeId) {
                $quote = DB::table('quotes')->where('id', $id)->lockForUpdate()->first();
                if ($quote === null || $quote->status !== 'pending' || $quote->created_at >= $cutoff->toDateTimeString()) {
                    return null;
                }
                $at = now('UTC');
                $envelope = PendingQuoteEvent::envelope($quote, $employeeId, $scanId, $at);
                DB::table('cu28_outbox')->insertOrIgnore([
                    'event_id' => $envelope['eventId'], 'quote_id' => $id,
                    'quote_version' => $envelope['aggregateVersion'], 'event_type' => PendingQuoteEvent::TYPE,
                    'payload' => json_encode($envelope, JSON_THROW_ON_ERROR),
                    'next_attempt_at' => $at, 'created_at' => $at,
                ]);
                return ['eventId' => $envelope['eventId'], 'aggregateId' => $id, 'aggregateVersion' => $envelope['aggregateVersion']];
            });
            if ($event !== null) $events[] = $event;
        }
        return $events;
    }
}
