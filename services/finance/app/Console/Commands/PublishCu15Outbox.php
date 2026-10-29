<?php

namespace App\Console\Commands;

use App\Infrastructure\Cu15\SqlOutboxPublisher;
use Illuminate\Console\Command;

final class PublishCu15Outbox extends Command
{
    protected $signature = 'cu15:publish-outbox {--once} {--loop}';
    protected $description = 'Publish committed financial CU15 events with broker confirmation';

    public function handle(SqlOutboxPublisher $publisher): int
    {
        if ($this->option('once') === $this->option('loop')) {
            $this->error('Choose --once or --loop.');
            return self::INVALID;
        }
        if (!config('cu15.messaging_enabled')) {
            $this->error('CU15 messaging is disabled.');
            return self::FAILURE;
        }
        try {
            do {
                $worked = $publisher->once();
                if ($this->option('loop') && !$worked) {
                    usleep(1000000);
                }
            } while ($this->option('loop'));
        } catch (\Throwable) {
            $this->error('CU15_OUTBOX_UNAVAILABLE');
            return self::FAILURE;
        }
        return self::SUCCESS;
    }
}
