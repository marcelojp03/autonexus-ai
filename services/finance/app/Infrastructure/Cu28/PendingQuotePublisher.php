<?php

namespace App\Infrastructure\Cu28;

use App\Support\TransportConfiguration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use InvalidArgumentException;

final class PendingQuotePublisher
{
    private const MAX_ATTEMPTS = 10;

    public function deliverNext(): ?string
    {
        $url = (string) config('cu28.webhook_url');
        $secret = (string) config('cu28.webhook_secret');
        TransportConfiguration::url($url, 'CU28_WEBHOOK_URL');
        if (trim($secret) === '' || preg_match('/[\r\n]/', $secret)) {
            throw new InvalidArgumentException('Invalid configuration: CU28_WEBHOOK_SECRET');
        }
        $claim = DB::transaction(function () {
            $at = now('UTC');
            $row = DB::table('cu28_outbox')->whereNull('delivered_at')->whereNull('suppressed_at')->whereNull('abandoned_at')
                ->where('next_attempt_at', '<=', $at)
                ->where(fn ($q) => $q->whereNull('lease_until')->orWhere('lease_until', '<=', $at))
                ->orderBy('next_attempt_at')->orderBy('event_id')->lock('FOR UPDATE SKIP LOCKED')->first();
            if ($row === null) return null;
            if ($row->attempts >= self::MAX_ATTEMPTS) {
                DB::table('cu28_outbox')->where('event_id', $row->event_id)->update([
                    'abandoned_at' => $at, 'last_error_code' => 'CU28_DELIVERY_ATTEMPTS_EXHAUSTED',
                    'lease_owner' => null, 'lease_until' => null,
                ]);
                return null;
            }
            $row->lease_owner = (string) Str::uuid();
            $row->attempts++;
            DB::table('cu28_outbox')->where('event_id', $row->event_id)->update([
                'lease_owner' => $row->lease_owner, 'lease_until' => $at->copy()->addSeconds(30), 'attempts' => $row->attempts,
            ]);
            return $row;
        });
        if ($claim === null) return null;

        // Holding the quote lock through the bounded POST prevents a decision racing the last check.
        DB::transaction(function () use ($claim, $url, $secret) {
            $quote = DB::table('quotes')->where('id', $claim->quote_id)->lockForUpdate()->first();
            $owned = DB::table('cu28_outbox')->where('event_id', $claim->event_id)
                ->where('lease_owner', $claim->lease_owner)->where('lease_until', '>', now('UTC'))
                ->lockForUpdate()->first();
            if ($owned === null) return;
            $changes = ['lease_owner' => null, 'lease_until' => null];
            if ($quote === null || $quote->status !== 'pending' || (int) $quote->version_number !== (int) $claim->quote_version) {
                $changes += ['suppressed_at' => now('UTC'), 'last_error_code' => 'CU28_QUOTE_STALE'];
            } else {
                try {
                    $response = Http::withHeaders(['x-autonexus-secret' => $secret])->acceptJson()
                        ->withOptions(['version' => 1.1])->withoutRedirecting()->connectTimeout(2)->timeout(15)
                        ->withBody($claim->payload, 'application/json')->post($url);
                    $error = $response->successful() ? null : 'CU28_WEBHOOK_HTTP_'.$response->status();
                } catch (\Throwable) {
                    $error = 'CU28_WEBHOOK_UNAVAILABLE';
                }
                if ($error === null) {
                    $changes += ['delivered_at' => now('UTC'), 'last_error_code' => null];
                } else {
                    $exhausted = $claim->attempts >= self::MAX_ATTEMPTS;
                    $changes += [
                        'next_attempt_at' => now('UTC')->addSeconds(min(10, 2 ** min(6, $claim->attempts - 1))),
                        'abandoned_at' => $exhausted ? now('UTC') : null,
                        'last_error_code' => $exhausted ? 'CU28_DELIVERY_ATTEMPTS_EXHAUSTED' : $error,
                    ];
                }
            }
            DB::table('cu28_outbox')->where('event_id', $claim->event_id)->where('lease_owner', $claim->lease_owner)
                ->where('lease_until', '>', now('UTC'))->update($changes);
        });
        return $claim->event_id;
    }
}
