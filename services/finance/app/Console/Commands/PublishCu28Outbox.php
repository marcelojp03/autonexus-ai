<?php

namespace App\Console\Commands;

use App\Infrastructure\Cu28\PendingQuotePublisher;
use Illuminate\Console\Command;

final class PublishCu28Outbox extends Command
{
    protected $signature = 'cu28:publish-outbox {--once} {--loop}';
    protected $description = 'Publish durable pending quote notices to the authenticated CU28 webhook';

    public function handle(PendingQuotePublisher $publisher): int
    {
        if ((bool) $this->option('once') === (bool) $this->option('loop')) {
            $this->error('Choose --once or --loop.');
            return 2;
        }
        if (trim((string) config('cu28.webhook_url')) === '') {
            $this->error('CU28 webhook is disabled.');
            return 1;
        }
        do {
            try {
                $id = $publisher->deliverNext();
                if ($id !== null) $this->info('CU28 event processed: '.$id);
            } catch (\InvalidArgumentException) {
                $this->error('Invalid CU28 webhook configuration.');
                return 2;
            } catch (\Throwable) {
                $this->error('CU28 publisher deferred.');
                if ($this->option('once')) return 1;
            }
            if ($this->option('loop')) sleep(2);
        } while ($this->option('loop'));
        return 0;
    }
}
