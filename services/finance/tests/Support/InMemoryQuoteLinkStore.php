<?php

namespace Tests\Support;

use App\Application\Cu15\QuoteLinkStore;
use Closure;

final class InMemoryQuoteLinkStore implements QuoteLinkStore
{
    public array $operations = [];
    public array $links = [];
    public array $quotes = [];
    public array $approvals = [];
    public array $audits = [];
    public array $events = [];
    public bool $failCommit = false;

    public function transaction(string $operationId, string $sagaId, Closure $work): array
    {
        $snapshot = [$this->operations, $this->links, $this->audits, $this->events];
        try {
            return $work();
        } catch (\Throwable $error) {
            [$this->operations, $this->links, $this->audits, $this->events] = $snapshot;
            throw $error;
        }
    }

    public function operation(string $operationId): ?array { return $this->operations[$operationId] ?? null; }
    public function link(string $sagaId): ?array { return $this->links[$sagaId] ?? null; }
    public function quote(string $quoteId): ?array { return $this->quotes[$quoteId] ?? null; }
    public function approval(string $quoteId): ?array { return $this->approvals[$quoteId] ?? null; }

    public function occupied(string $orderId, string $quoteId): bool
    {
        foreach ($this->links as $link) {
            if ($link['status'] === 'active' && ($link['orderId'] === $orderId || $link['quoteId'] === $quoteId)) {
                return true;
            }
        }
        return false;
    }

    public function saveLink(array $resource, ?array $approval, array $body): void { $this->links[$resource['sagaId']] = $resource; }

    public function commitResult(array $result, array $body): void
    {
        if ($this->failCommit) {
            throw new \RuntimeException('injected-storage-failure');
        }
        $this->operations[$result['operationId']] = $result;
        $this->audits[] = $result;
        $this->events[] = $result;
    }
}
