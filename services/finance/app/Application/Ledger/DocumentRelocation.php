<?php

namespace App\Application\Ledger;

use App\Domain\CanonicalJson;
use RuntimeException;

final class DocumentRelocation
{
    public function __construct(private readonly DocumentRelocationRepository $repository) {}

    public function prepare(string $operationId, DocumentStorage $source, DocumentStorage $target, string $sourceFingerprint, string $targetFingerprint): array
    {
        if ($sourceFingerprint === $targetFingerprint) { throw new RuntimeException('RELOCATION_SAME_PROFILE'); }
        return $this->repository->locked(function () use ($operationId, $source, $target, $sourceFingerprint, $targetFingerprint) {
            $transfer = $this->repository->transfer($operationId);
            if ($transfer === null) {
                $transfer = ['operation_id' => $operationId, 'source_fingerprint' => $sourceFingerprint,
                    'target_fingerprint' => $targetFingerprint, 'state' => 'prepared', 'created_at' => $this->now(), 'committed_at' => null];
                $this->repository->start($transfer);
            }
            if ($transfer['source_fingerprint'] !== $sourceFingerprint || $transfer['target_fingerprint'] !== $targetFingerprint) {
                throw new RuntimeException('RELOCATION_IDEMPOTENCY_CONFLICT');
            }
            if ($transfer['state'] === 'committed') { return $this->statusUnlocked($operationId); }
            $source->assertConfigured();
            $target->assertConfigured();
            $items = $this->repository->items($operationId);
            foreach ($this->repository->uploaded() as $document) {
                $snapshot = CanonicalJson::encode($document);
                $existing = $items[$document['id']] ?? null;
                if ($existing !== null && $existing['document_snapshot'] !== $snapshot) {
                    throw new RuntimeException('RELOCATION_DOCUMENT_CHANGED');
                }
                $bytes = $source->get($document['object_key'], $document['object_version']);
                $this->verify($document, $bytes);
                $version = $existing['new_version'] ?? $target->put($document['object_key'], $bytes, $document['content_type']);
                if ($version === '' || $version === 'null') { throw new RuntimeException('RELOCATION_INVALID_VERSION'); }
                $this->verify($document, $target->get($document['object_key'], $version));
                if ($existing === null) {
                    $this->repository->prepareItem(['operation_id' => $operationId, 'document_id' => $document['id'],
                        'old_version' => $document['object_version'], 'new_version' => $version, 'document_snapshot' => $snapshot,
                        'source_fingerprint' => $sourceFingerprint, 'target_fingerprint' => $targetFingerprint, 'prepared_at' => $this->now()]);
                }
            }
            return $this->statusUnlocked($operationId);
        });
    }

    public function commit(string $operationId, DocumentStorage $target, string $targetFingerprint, callable $activeFingerprint, callable $ready): array
    {
        return $this->repository->locked(function () use ($operationId, $target, $targetFingerprint, $activeFingerprint, $ready) {
            $transfer = $this->repository->transfer($operationId) ?? throw new RuntimeException('RELOCATION_NOT_FOUND');
            if ($transfer['target_fingerprint'] !== $targetFingerprint) { throw new RuntimeException('RELOCATION_IDEMPOTENCY_CONFLICT'); }
            $status = $this->statusUnlocked($operationId);
            if ($transfer['state'] === 'committed') {
                if ($status['position'] !== 'allNew') { throw new RuntimeException('RELOCATION_MIXED'); }
                return $status;
            }
            if ($status['position'] !== 'allOld') { throw new RuntimeException('RELOCATION_MIXED'); }
            $documents = $this->repository->uploaded();
            $items = $this->repository->items($operationId);
            if (count($documents) !== count($items)) { throw new RuntimeException('RELOCATION_COVERAGE_MISMATCH'); }
            $target->assertConfigured();
            foreach ($documents as $document) {
                $item = $items[$document['id']] ?? throw new RuntimeException('RELOCATION_COVERAGE_MISMATCH');
                if ($item['document_snapshot'] !== CanonicalJson::encode($document)
                    || $item['source_fingerprint'] !== $transfer['source_fingerprint'] || $item['target_fingerprint'] !== $targetFingerprint) {
                    throw new RuntimeException('RELOCATION_DOCUMENT_CHANGED');
                }
                $this->verify($document, $target->get($document['object_key'], $item['new_version']));
            }
            if ($ready(['event' => 'READY_TO_SWITCH', 'operationId' => $operationId, 'documents' => count($items),
                'sourceFingerprint' => $transfer['source_fingerprint'], 'targetFingerprint' => $targetFingerprint]) !== 'SWITCHED') {
                throw new RuntimeException('RELOCATION_ABORTED');
            }
            if (!hash_equals($targetFingerprint, $activeFingerprint())) { throw new RuntimeException('RELOCATION_ACTIVE_PROFILE_MISMATCH'); }
            $at = $this->now();
            foreach ($items as $item) { $this->repository->relocate($item, $at); }
            $this->repository->committed($operationId, $at);
            return $this->statusUnlocked($operationId);
        });
    }

    public function status(string $operationId): array
    {
        return $this->repository->locked(fn () => $this->statusUnlocked($operationId));
    }

    private function statusUnlocked(string $operationId): array
    {
        $transfer = $this->repository->transfer($operationId) ?? throw new RuntimeException('RELOCATION_NOT_FOUND');
        $documents = array_column($this->repository->uploaded(), null, 'id');
        $items = $this->repository->items($operationId);
        $history = $this->repository->history($operationId);
        $old = $new = $unexpected = 0;
        foreach ($items as $id => $item) {
            $version = $documents[$id]['object_version'] ?? null;
            if ($version === $item['new_version'] && isset($history[$id]) && $history[$id]['new_version'] === $version
                && $history[$id]['old_version'] === $item['old_version']) { $new++; }
            elseif ($version === $item['old_version'] && !isset($history[$id])) { $old++; }
            else { $unexpected++; }
        }
        $committed = $transfer['state'] === 'committed';
        $position = !$committed && $old === count($items) ? 'allOld' : ($committed && $new === count($items) ? 'allNew' : 'mixed');
        return ['event' => 'RELOCATION_STATUS', 'operationId' => $operationId, 'state' => $transfer['state'], 'position' => $position,
            'documents' => count($items), 'old' => $old, 'new' => $new, 'unexpected' => $unexpected,
            'uploaded' => count($documents), 'covered' => count($items) === count($documents) && count(array_diff_key($documents, $items)) === 0,
            'sourceFingerprint' => $transfer['source_fingerprint'], 'targetFingerprint' => $transfer['target_fingerprint']];
    }

    private function verify(array $document, string $bytes): void
    {
        $image = @getimagesizefromstring($bytes);
        if (strlen($bytes) !== (int) $document['size_bytes'] || !hash_equals($document['sha256'], hash('sha256', $bytes))
            || !is_array($image) || $image['mime'] !== $document['content_type']) {
            throw new RuntimeException('RELOCATION_CONTENT_MISMATCH');
        }
    }

    private function now(): string { return gmdate('Y-m-d\TH:i:s').'.000Z'; }
}
