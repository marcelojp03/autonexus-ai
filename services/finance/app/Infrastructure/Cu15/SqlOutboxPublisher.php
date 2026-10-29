<?php

namespace App\Infrastructure\Cu15;

use App\Application\Cu15\EventPublisher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

final class SqlOutboxPublisher
{
    public function __construct(private readonly EventPublisher $publisher) {}

    public function once(): bool
    {
        $owner = (string) Str::uuid();
        $row = DB::transaction(function () use ($owner) {
            $row = DB::table('cu15_outbox')->whereNull('published_at')->where('next_attempt_at', '<=', now('UTC'))
                ->where(fn ($q) => $q->whereNull('lease_until')->orWhere('lease_until', '<', now('UTC')))
                ->orderBy('occurred_at')->lock('FOR UPDATE SKIP LOCKED')->first();
            if ($row !== null) {
                DB::table('cu15_outbox')->where('id', $row->id)->update([
                    'lease_owner' => $owner, 'lease_until' => now('UTC')->addSeconds(30), 'attempts' => $row->attempts + 1,
                ]);
            }
            return $row;
        });
        if ($row === null) {
            return false;
        }
        try {
            $this->publisher->publish($row->id, $row->event_type, $row->payload);
            DB::table('cu15_outbox')->where('id', $row->id)->where('lease_owner', $owner)->where('lease_until', '>', now('UTC'))->update([
                'published_at' => now('UTC'), 'lease_owner' => null, 'lease_until' => null, 'last_error_code' => null,
            ]);
        } catch (Throwable) {
            DB::table('cu15_outbox')->where('id', $row->id)->where('lease_owner', $owner)->update([
                'lease_owner' => null, 'lease_until' => null, 'last_error_code' => 'PUBLISH_UNCONFIRMED',
                'next_attempt_at' => now('UTC')->addSeconds(min(30, 2 ** min(5, $row->attempts))),
            ]);
        }
        return true;
    }
}
