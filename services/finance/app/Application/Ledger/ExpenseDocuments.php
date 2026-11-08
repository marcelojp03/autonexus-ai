<?php

namespace App\Application\Ledger;

use App\Domain\CanonicalJson;
use Illuminate\Support\Str;

final class ExpenseDocuments
{
    public function __construct(private readonly LedgerStore $ledger, private readonly DocumentRepository $documents, private readonly DocumentStorage $storage) {}

    public function command(string $action, array $body, array $actor): array
    {
        $fingerprint = hash('sha256', CanonicalJson::encode([$actor['subject'], $action, $body]));
        return $this->ledger->transaction(function () use ($action, $body, $actor, $fingerprint) {
            $id = $body['operationId'];
            $this->ledger->lock('operation:'.$id);
            $operation = $this->ledger->find('operations', $id);
            if ($operation !== null) {
                if (!hash_equals($operation['fingerprint'], $fingerprint)) { throw new LedgerError('IDEMPOTENCY_CONFLICT'); }
                $result = json_decode($operation['resultJson'], true, 512, JSON_THROW_ON_ERROR);
                $result['replayed'] = true;
                $status = $operation['status'];
            } else {
                try {
                    $this->storage->assertConfigured();
                    $document = $action === 'request_document' ? $this->request($body, $actor) : $this->confirm($body['documentId'], $actor);
                    $result = ['document' => $this->dto($document), 'replayed' => false];
                    $status = 200;
                    $error = null;
                } catch (LedgerError $e) {
                    if (!in_array($e->status, [404, 409], true)) { throw $e; }
                    $status = $e->status;
                    $error = $e->getMessage();
                    $result = ['statusCode' => $status, 'code' => $error, 'message' => 'Request failed', 'replayed' => false];
                }
                $operation = ['operationId' => $id, 'action' => $action, 'outcome' => $error === null ? 'applied' : 'rejected',
                    'status' => $status, 'committedAt' => $this->now(), 'resultJson' => CanonicalJson::encode($result), 'errorCode' => $error,
                    'actorSubject' => $actor['subject'], 'fingerprint' => $fingerprint];
                $this->ledger->put('operations', $id, $operation);
                $this->ledger->put('audit', $id, [...$operation, 'employeeId' => $actor['employeeId'], 'body' => $body]);
            }
            if ($status === 200 && $action === 'request_document') {
                $document = $this->owned($result['document']['id'], $actor);
                $result['upload'] = $document['state'] === 'pending' ? $this->target($document, 'PUT') : null;
            }
            return ['status' => $status, 'body' => $result];
        });
    }

    private function request(array $b, array $actor): array
    {
        $id = (string) Str::uuid();
        $document = ['id' => $id, 'owner_subject' => $actor['subject'], 'file_name' => $b['fileName'], 'content_type' => $b['contentType'],
            'size_bytes' => $b['sizeBytes'], 'sha256' => $b['sha256'], 'state' => 'pending', 'object_key' => 'finance/expense-documents/'.$id,
            'object_version' => null, 'expense_id' => null, 'created_at' => $this->now()];
        $this->documents->insert($document);
        return $document;
    }

    private function confirm(string $id, array $actor): array
    {
        $d = $this->owned($id, $actor);
        if ($d['object_version'] === null) { throw new LedgerError('DOCUMENT_NOT_AVAILABLE'); }
        $this->validateBytes($d, $this->storage->get($d['object_key'], $d['object_version']));
        $this->documents->available($id);
        return [...$d, 'state' => 'available'];
    }

    public function download(string $id, array $actor): array
    {
        return $this->ledger->transaction(function () use ($id, $actor) {
            $d = $this->documents->find($id) ?? throw new LedgerError('DOCUMENT_NOT_FOUND', 404);
            if ($d['owner_subject'] !== $actor['subject'] && $d['expense_id'] === null) { throw new LedgerError('DOCUMENT_NOT_FOUND', 404); }
            if ($d['state'] !== 'available' || $d['object_version'] === null) { throw new LedgerError('DOCUMENT_NOT_AVAILABLE'); }
            $this->storage->assertConfigured();
            return $this->target($d, 'GET');
        });
    }

    public function content(string $id, string $grant, string $method, ?string $bytes = null, ?string $contentType = null): array
    {
        if (!preg_match('/^[a-f0-9]{64}$/D', $grant)) { throw new LedgerError('FORBIDDEN', 403); }
        return $this->ledger->transaction(function () use ($id, $grant, $method, $bytes, $contentType) {
            $g = $this->documents->findGrant(hash('sha256', $grant));
            if ($g === null || $g['document_id'] !== $id || $g['method'] !== $method || (int) $g['expires_at'] <= time()) { throw new LedgerError('FORBIDDEN', 403); }
            $d = $this->documents->find($id) ?? throw new LedgerError('DOCUMENT_NOT_FOUND', 404);
            if ($method === 'PUT') {
                if ($contentType !== $d['content_type']) { throw new LedgerError('DOCUMENT_TYPE_NOT_ALLOWED', 400); }
                $this->validateBytes($d, $bytes);
                if ($d['object_version'] === null) {
                    $version = $this->storage->put($d['object_key'], $bytes, $d['content_type']);
                    $this->documents->uploaded($id, $version);
                }
                return [];
            }
            if ($d['state'] !== 'available' || $g['object_version'] !== $d['object_version']) { throw new LedgerError('DOCUMENT_NOT_AVAILABLE'); }
            $bytes = $this->storage->get($d['object_key'], $g['object_version']);
            $this->validateBytes($d, $bytes);
            return ['bytes' => $bytes, 'contentType' => $d['content_type']];
        });
    }

    private function owned(string $id, array $actor): array
    {
        $d = $this->documents->find($id);
        if ($d === null || $d['owner_subject'] !== $actor['subject']) { throw new LedgerError('DOCUMENT_NOT_FOUND', 404); }
        return $d;
    }

    private function target(array $d, string $method): array
    {
        $grant = bin2hex(random_bytes(32));
        $expires = time() + 120;
        $this->documents->grant(['hash' => hash('sha256', $grant), 'document_id' => $d['id'], 'method' => $method, 'object_version' => $d['object_version'], 'expires_at' => $expires]);
        $headers = ['X-Finance-Grant' => $grant];
        if ($method === 'PUT') { $headers['Content-Type'] = $d['content_type']; }
        return ['url' => '/finance-files/documents/'.$d['id'].'/content', 'method' => $method,
            'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', $expires), 'headersJson' => json_encode($headers, JSON_THROW_ON_ERROR)];
    }

    private function validateBytes(array $d, string $bytes): void
    {
        $image = @getimagesizefromstring($bytes);
        if (strlen($bytes) !== (int) $d['size_bytes'] || !hash_equals($d['sha256'], hash('sha256', $bytes)) || !is_array($image) || $image['mime'] !== $d['content_type']) {
            throw new LedgerError('DOCUMENT_TYPE_NOT_ALLOWED', 400);
        }
    }

    private function dto(array $d): array
    {
        return ['id' => $d['id'], 'fileName' => $d['file_name'], 'contentType' => $d['content_type'], 'sizeBytes' => (int) $d['size_bytes'],
            'sha256' => $d['sha256'], 'state' => $d['state'], 'createdAt' => $d['created_at'], 'expenseId' => $d['expense_id']];
    }

    private function now(): string { return gmdate('Y-m-d\TH:i:s').'.000Z'; }
}
