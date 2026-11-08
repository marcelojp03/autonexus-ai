<?php

namespace App\Application\Ledger;

use App\Domain\CanonicalJson;
use App\Domain\Ledger\CollectionPolicy;
use App\Domain\Ledger\Money;
use Illuminate\Support\Str;

final class FinancialLedger
{
    public function __construct(private readonly LedgerStore $store, private readonly CollectionContext $contexts) {}

    public function command(string $action, string $target, array $body, array $actor, string $token): array
    {
        $fp = hash('sha256', CanonicalJson::encode([$actor['subject'], $action, $target, $body]));
        $id = $body['operationId'];
        $replay = $this->replay($id, $fp);
        if ($replay !== null) {
            return $replay;
        }
        return $this->store->transaction(function () use ($action, $target, $body, $actor, $token, $fp, $id) {
            $this->store->lock('operation:'.$id);
            $replay = $this->replay($id, $fp);
            if ($replay !== null) {
                return $replay;
            }
            $this->store->lock(($action === 'record_expense' ? 'expense-intent:' : 'order:').$target);
            try {
                $result = match ($action) {
                    'record_payment' => $this->pay($target, $body, $actor, $token),
                    'verify_reference' => $this->verify($target, $body, $actor, $token),
                    'record_expense' => $this->expense($body, $actor),
                    default => throw new \LogicException('Unknown action'),
                };
                $status = 200;
                $error = null;
            } catch (LedgerError $e) {
                if ($e->status !== 409 && $e->status !== 404) {
                    throw $e;
                }
                $status = $e->status;
                $error = $e->getMessage();
                $result = ['statusCode' => $status, 'code' => $error, 'message' => 'Request failed', ...$e->details];
            }
            $result['replayed'] = false;
            $operation = [
                'operationId' => $id, 'action' => $action, 'outcome' => $error === null ? 'applied' : 'rejected',
                'status' => $status, 'committedAt' => $this->now(), 'resultJson' => CanonicalJson::encode($result), 'errorCode' => $error,
            ];
            $this->store->put('operations', $id, [...$operation, 'actorSubject' => $actor['subject'], 'fingerprint' => $fp]);
            $this->store->put('audit', $id, [...$operation, 'actorSubject' => $actor['subject'], 'employeeId' => $actor['employeeId'], 'target' => $target, 'body' => $body]);
            return ['status' => $status, 'body' => $result];
        });
    }

    public function operation(string $id, array $actor): array
    {
        $op = $this->store->find('operations', $id) ?? throw new LedgerError('OPERATION_NOT_FOUND', 404);
        $module = in_array($op['action'], ['record_expense', 'request_document', 'confirm_document'], true) ? 'expenses' : 'payments';
        if (!in_array($module.':read', $actor['permissions'], true)
            && !($op['actorSubject'] === $actor['subject'] && in_array($module.':write', $actor['permissions'], true))) {
            throw new LedgerError('FORBIDDEN', 403);
        }
        unset($op['actorSubject'], $op['fingerprint']);
        return $op;
    }

    private function replay(string $id, string $fp): ?array
    {
        $op = $this->store->find('operations', $id);
        if ($op === null) {
            return null;
        }
        if (!hash_equals($op['fingerprint'], $fp)) {
            throw new LedgerError('IDEMPOTENCY_CONFLICT');
        }
        return ['status' => $op['status'], 'body' => [...json_decode($op['resultJson'], true, 512, JSON_THROW_ON_ERROR), 'replayed' => true]];
    }

    public function receivable(string $orderId, string $token): array
    {
        return $this->store->transaction(fn () => $this->projection($orderId, $token));
    }

    private function projection(string $orderId, string $token): array
    {
        $c = $this->contexts->get($orderId, $token);
        if ($c['orderStatus'] !== 'completed' || $c['sagaStatus'] !== 'confirmed' || !$c['eligibleForCollection']) {
            throw new LedgerError('ORDER_NOT_FINALIZED');
        }
        $linked = $this->store->linkedQuote($orderId) ?? throw new LedgerError('OBLIGATION_NOT_FOUND', 404);
        $l = $linked['link'];
        $q = $linked['quote'];
        foreach (['sagaId' => 'saga_id', 'quoteId' => 'quote_id', 'quoteLinkId' => 'id'] as $external => $local) {
            if (($c[$external] ?? null) !== $l[$local]) {
                throw new LedgerError('OBLIGATION_MISMATCH');
            }
        }
        if ($q === null || (int) ($c['quoteVersion'] ?? 0) !== (int) $l['quote_version']
            || (int) $q['version_number'] !== (int) $l['quote_version'] || $q['order_reference'] !== $orderId || $q['currency'] !== 'BOB') {
            throw new LedgerError('OBLIGATION_MISMATCH');
        }
        try {
            $agreed = Money::decimal($q['exact_total']);
        } catch (\InvalidArgumentException) {
            throw new LedgerError('BALANCE_INCONSISTENT');
        }
        $obligation = $this->store->find('obligations', $orderId);
        if ($obligation !== null && ($obligation['agreedAmountMinor'] !== $agreed || $obligation['quoteLinkId'] !== $c['quoteLinkId'])) {
            throw new LedgerError('OBLIGATION_MISMATCH');
        }
        $payments = array_values(array_filter($this->store->rows('payments'), fn ($p) => $p['orderId'] === $orderId));
        $paid = $this->sum($payments);
        $balance = Money::subtract($agreed, $paid);
        if (str_starts_with($balance, '-')) {
            throw new LedgerError('BALANCE_INCONSISTENT');
        }
        return [
            'orderId' => $orderId, 'orderNumber' => $c['orderNumber'], 'orderStatus' => $c['orderStatus'], 'orderVersion' => $c['orderVersion'],
            'sagaId' => $c['sagaId'], 'quoteId' => $c['quoteId'], 'quoteVersion' => $c['quoteVersion'], 'quoteLinkId' => $c['quoteLinkId'],
            'agreedAmountMinor' => $agreed, 'paidAmountMinor' => $paid, 'balanceMinor' => $balance, 'currency' => 'BOB',
            'balanceVersion' => $obligation['balanceVersion'] ?? 0, 'policyCode' => CollectionPolicy::CODE,
            'payments' => $payments, 'observedAt' => $c['observedAt'],
        ];
    }

    private function pay(string $orderId, array $b, array $actor, string $token): array
    {
        $r = $this->projection($orderId, $token);
        if ($r['balanceVersion'] !== $b['expectedVersion']) {
            throw new LedgerError('VERSION_CONFLICT');
        }
        $error = CollectionPolicy::paymentError($b['amountMinor'], $r['balanceMinor']);
        if ($error !== null) {
            throw new LedgerError($error);
        }
        $vId = $b['referenceVerificationId'] ?? null;
        if ($b['method'] !== 'cash') {
            $v = $vId === null ? null : $this->store->find('verifications', $vId);
            if ($v === null || $v['orderId'] !== $orderId || $v['method'] !== $b['method'] || $v['amountMinor'] !== $b['amountMinor'] || $v['verifierSubject'] !== $actor['subject'] || $v['employeeId'] !== $actor['employeeId'] || $v['status'] !== 'human_verified') {
                throw new LedgerError('PAYMENT_REFERENCE_UNVERIFIED');
            }
            $this->store->lock('reference:'.hash('sha256', $v['reference']));
            foreach ($this->store->rows('payments') as $p) {
                if ($p['referenceVerificationId'] !== null) {
                    $used = $this->store->find('verifications', $p['referenceVerificationId']);
                    if ($used['reference'] === $v['reference']) {
                        throw new LedgerError('PAYMENT_REFERENCE_ALREADY_USED');
                    }
                }
            }
        }
        $obligation = $this->store->find('obligations', $orderId);
        $oId = $obligation['id'] ?? $this->id();
        $pId = $this->id();
        $receiptId = $this->id();
        $number = 'INT-'.strtoupper(str_replace('-', '', $receiptId));
        $at = $this->now();
        $p = [
            'id' => $pId, 'orderId' => $orderId, 'orderNumber' => $r['orderNumber'], 'obligationId' => $oId,
            'amountMinor' => $b['amountMinor'], 'currency' => 'BOB', 'method' => $b['method'], 'referenceVerificationId' => $vId,
            'receiptId' => $receiptId, 'receiptNumber' => $number, 'recordedAt' => $at, 'actorSubject' => $actor['subject'], 'employeeId' => $actor['employeeId'],
        ];
        $receipt = [
            'id' => $receiptId, 'number' => $number, 'paymentId' => $pId, 'orderId' => $orderId, 'orderNumber' => $r['orderNumber'],
            'amountMinor' => $b['amountMinor'], 'currency' => 'BOB', 'method' => $b['method'], 'recordedAt' => $at,
            'actorSubject' => $actor['subject'], 'employeeId' => $actor['employeeId'], 'fiscalStatus' => 'internal_non_fiscal', 'referenceVerificationId' => $vId,
        ];
        $r['balanceVersion']++;
        $r['paidAmountMinor'] = Money::add($r['paidAmountMinor'], $p['amountMinor']);
        $r['balanceMinor'] = Money::subtract($r['agreedAmountMinor'], $r['paidAmountMinor']);
        $r['payments'][] = $p;
        $this->store->put('obligations', $orderId, ['id' => $oId, ...$r]);
        $this->store->put('payments', $pId, $p);
        $this->store->put('receipts', $pId, $receipt);
        return ['payment' => $p, 'receivable' => $r, 'receipt' => $receipt];
    }

    private function verify(string $orderId, array $b, array $actor, string $token): array
    {
        // Verification metadata must also reference a real, currently authorized order.
        $this->contexts->get($orderId, $token);
        $this->store->lock('reference:'.hash('sha256', $b['reference']));
        foreach ($this->store->rows('verifications') as $v) {
            if ($v['reference'] === $b['reference']) {
                if ($v['orderId'] !== $orderId || $v['method'] !== $b['method'] || $v['amountMinor'] !== $b['amountMinor']
                    || $v['verifierSubject'] !== $actor['subject'] || $v['employeeId'] !== $actor['employeeId'] || $v['status'] !== 'human_verified') {
                    throw new LedgerError('PAYMENT_REFERENCE_ALREADY_USED');
                }
                foreach ($this->store->rows('payments') as $payment) {
                    if ($payment['referenceVerificationId'] === $v['id']) {
                        throw new LedgerError('PAYMENT_REFERENCE_ALREADY_USED');
                    }
                }
                // Recover the original unused record; never replace its verifier, note or time.
                return ['verification' => $v];
            }
        }
        $v = ['id' => $this->id(), 'orderId' => $orderId, 'method' => $b['method'], 'amountMinor' => $b['amountMinor'], 'reference' => $b['reference'],
            'status' => 'human_verified', 'verifiedAt' => $this->now(), 'verifierSubject' => $actor['subject'], 'employeeId' => $actor['employeeId'], 'note' => $b['note']];
        $this->store->put('verifications', $v['id'], $v);
        return ['verification' => $v];
    }

    private function expense(array $b, array $actor): array
    {
        $category = $this->store->find('categories', $b['categoryId']);
        if ($category === null || !$category['active']) {
            throw new LedgerError('EXPENSE_CATEGORY_INVALID');
        }
        $document = null;
        if (($b['documentId'] ?? null) !== null) {
            $d = $this->store->document($b['documentId']);
            if ($d === null || $d['owner_subject'] !== $actor['subject']) {
                throw new LedgerError('DOCUMENT_NOT_FOUND', 404);
            }
            if ($d['state'] !== 'available' || $d['expense_id'] !== null) {
                throw new LedgerError('DOCUMENT_NOT_AVAILABLE');
            }
            $document = ['id' => $d['id'], 'fileName' => $d['file_name'], 'contentType' => $d['content_type'], 'sizeBytes' => (int) $d['size_bytes'],
                'sha256' => $d['sha256'], 'state' => $d['state'], 'createdAt' => $d['created_at'], 'expenseId' => null];
        }
        $key = hash('sha256', CanonicalJson::encode([$b['expenseDate'], $b['categoryId'], $b['amountMinor'], $b['method'], mb_strtolower(preg_replace('/\s+/u', ' ', trim($b['description'])))]));
        $locks = ['expense-key:'.$key];
        if ($document !== null) {
            $locks[] = 'document-hash:'.$document['sha256'];
        }
        sort($locks);
        foreach ($locks as $lock) {
            $this->store->lock($lock);
        }
        $candidates = array_values(array_filter($this->store->rows('expenses'), fn ($e) => $e['duplicateKey'] === $key || ($document !== null && ($e['document']['sha256'] ?? null) === $document['sha256'])));
        if ($candidates !== []) {
            $ids = array_column($candidates, 'id');
            if (!in_array($b['duplicateOf'] ?? null, $ids, true)) {
                throw new LedgerError('EXPENSE_POSSIBLE_DUPLICATE', 409, ['candidate' => $this->expenseDto($candidates[0])]);
            }
        } elseif (($b['duplicateOf'] ?? null) !== null) {
            throw new LedgerError('EXPENSE_POSSIBLE_DUPLICATE');
        }
        $id = $this->id();
        if ($document !== null) {
            $document['expenseId'] = $id;
        }
        $e = ['id' => $id, 'description' => $b['description'], 'category' => $category, 'expenseDate' => $b['expenseDate'], 'amountMinor' => $b['amountMinor'],
            'currency' => 'BOB', 'method' => $b['method'], 'document' => $document, 'duplicateOf' => $b['duplicateOf'] ?? null, 'duplicateReason' => $b['duplicateReason'] ?? null,
            'recordedAt' => $this->now(), 'actorSubject' => $actor['subject'], 'employeeId' => $actor['employeeId'], 'duplicateKey' => $key];
        $this->store->put('expenses', $id, $e);
        if ($document !== null) {
            $this->store->attachDocument($document['id'], $id);
        }
        return ['expense' => $this->expenseDto($e)];
    }

    public function receipt(string $paymentId): array
    {
        return $this->store->find('receipts', $paymentId) ?? throw new LedgerError('PAYMENT_NOT_FOUND', 404);
    }

    public function categories(): array
    {
        return array_values(array_filter($this->store->rows('categories'), fn ($c) => $c['active']));
    }

    public function expenseDetail(string $id): array
    {
        return $this->expenseDto($this->store->find('expenses', $id) ?? throw new LedgerError('EXPENSE_NOT_FOUND', 404));
    }

    public function listing(string $collection, array $query): array
    {
        $items = array_values(array_filter($this->store->rows($collection), function ($r) use ($query, $collection) {
            $date = $collection === 'expenses' ? $r['expenseDate'] : (new \DateTimeImmutable($r['recordedAt']))->setTimezone(new \DateTimeZone('America/La_Paz'))->format('Y-m-d');
            return (!isset($query['from']) || $date >= $query['from']) && (!isset($query['to']) || $date <= $query['to'])
                && (!isset($query['categoryId']) || ($r['category']['id'] ?? null) === $query['categoryId']);
        }));
        $total = $this->sum($items);
        usort($items, fn ($a, $b) => strcmp($b['recordedAt'].$b['id'], $a['recordedAt'].$a['id']));
        $limit = $query['limit'] ?? 50;
        $offset = $query['offset'] ?? 0;
        return ['items' => array_map(fn ($r) => $collection === 'expenses' ? $this->expenseDto($r) : $r, array_slice($items, $offset, $limit)),
            'page' => ['total' => count($items), 'limit' => $limit, 'offset' => $offset], 'totalAmountMinor' => $total];
    }

    public function summary(array $q): array
    {
        return $this->store->transaction(function () use ($q) {
            $p = $this->listing('payments', $q);
            $e = $this->listing('expenses', $q);
            return ['from' => $q['from'], 'to' => $q['to'], 'timeZone' => 'America/La_Paz', 'currency' => 'BOB',
                'paymentCount' => $p['page']['total'], 'expenseCount' => $e['page']['total'], 'receivedAmountMinor' => $p['totalAmountMinor'],
                'expenseAmountMinor' => $e['totalAmountMinor'], 'netMovementMinor' => Money::subtract($p['totalAmountMinor'], $e['totalAmountMinor']), 'generatedAt' => $this->now()];
        });
    }

    public function receivables(array $q, string $token): array
    {
        $items = [];
        foreach ($this->store->activeOrderIds() as $id) {
            try {
                $r = $this->receivable($id, $token);
            } catch (LedgerError $e) {
                if (in_array($e->getMessage(), ['ORDER_NOT_FINALIZED', 'OBLIGATION_NOT_FOUND'], true)) {
                    continue;
                }
                throw $e;
            }
            if (($q['status'] ?? 'all') === 'all' || (($q['status'] === 'paid') === ($r['balanceMinor'] === '0'))) {
                $items[] = $r;
            }
        }
        return ['items' => array_slice($items, $q['offset'] ?? 0, $q['limit'] ?? 50), 'page' => ['total' => count($items), 'limit' => $q['limit'] ?? 50, 'offset' => $q['offset'] ?? 0]];
    }

    private function expenseDto(array $e): array
    {
        unset($e['duplicateKey']);
        return $e;
    }

    private function sum(array $items): string
    {
        return array_reduce($items, fn ($sum, $p) => Money::add($sum, $p['amountMinor']), '0');
    }

    private function id(): string { return (string) Str::uuid(); }
    private function now(): string { return (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'); }
}
