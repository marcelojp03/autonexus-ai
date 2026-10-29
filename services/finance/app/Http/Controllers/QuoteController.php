<?php

namespace App\Http\Controllers;

use App\Domain\QuotePolicy;
use App\Domain\CanonicalJson;
use App\Domain\CivilQuoteCalendar;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;

/** CU13 and CU14: versioned quotes and the client decision. Approval is not a confirmed service. */
final class QuoteController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        return $this->write($request, fn () => $this->storeInTransaction($request));
    }

    public function revise(Request $request, string $id): JsonResponse
    {
        return $this->write($request, fn () => $this->reviseInTransaction($request, $id));
    }

    public function decide(Request $request, string $id): JsonResponse
    {
        return $this->write($request, fn () => $this->decideInTransaction($request, $id));
    }

    private function write(Request $request, \Closure $work): JsonResponse
    {
        $operationId = $request->json('operationId');
        if (!is_string($operationId) || !Str::isUuid($operationId)) {
            return $this->failure(400, 'VALIDATION_ERROR');
        }
        return DB::transaction(function () use ($operationId, $work) {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['finance.operation:'.strtolower($operationId)]);
            return $work();
        }, 3);
    }

    public function index(Request $request): JsonResponse
    {
        $limit = $this->int($request->query('limit'), 20, 1, 100);
        $offset = $this->int($request->query('offset'), 0, 0, 1000000);
        $query = DB::table('quotes');
        if ($request->filled('orderReference')) {
            $query->where('order_reference', (string) $request->query('orderReference'));
        }
        if ($request->filled('status')) {
            $status = (string) $request->query('status');
            if (!in_array($status, ['pending', 'approved', 'rejected', 'superseded', 'expired'], true)) {
                return $this->failure(400, 'VALIDATION_ERROR');
            }
            $query->where('status', $status);
        }
        $total = (clone $query)->count();
        $rows = $query->orderByDesc('created_at')->orderBy('id')->offset($offset)->limit($limit)->get();
        return response()->json([
            'items' => $rows->map(fn ($row) => $this->view((array) $row))->all(),
            'total' => $total,
            'limit' => $limit,
            'offset' => $offset,
        ]);
    }

    public function show(string $id): JsonResponse
    {
        $row = DB::table('quotes')->where('id', $id)->first();
        if ($row === null) {
            return $this->failure(404, 'QUOTE_NOT_FOUND');
        }
        return response()->json($this->view((array) $row));
    }

    private function storeInTransaction(Request $request): JsonResponse
    {
        $operationId = (string) ($request->json('operationId') ?? '');
        if (!Str::isUuid($operationId)) {
            return $this->failure(400, 'VALIDATION_ERROR');
        }
        $subject = (string) $request->attributes->get('subject');
        $payload = $request->json()->all();
        $fingerprint = hash('sha256', CanonicalJson::encode(['subject' => $subject, 'command' => 'create', 'body' => $payload]));
        if ($replay = $this->replay($operationId, $fingerprint)) {
            return response()->json(['quote' => $replay, 'replayed' => true], 200);
        }
        try {
            $items = $this->items($payload['items'] ?? null);
            $discount = (float) ($payload['discountPercent'] ?? 0);
            $tax = (float) ($payload['taxPercent'] ?? 13);
            $computed = QuotePolicy::calculate($items, $discount, $tax);
            QuotePolicy::assertConsistent(isset($payload['total']) ? (float) $payload['total'] : null, $computed['total']);
            $validUntil = (string) ($payload['validUntil'] ?? '');
            if (!CivilQuoteCalendar::current($validUntil, now('UTC'))) {
                throw new InvalidArgumentException('VALIDATION_ERROR');
            }
            foreach (['orderReference', 'orderNumber', 'customerReference', 'vehicleReference', 'vehiclePlate'] as $field) {
                if (!is_string($payload[$field] ?? null) || trim((string) $payload[$field]) === '') {
                    throw new InvalidArgumentException('VALIDATION_ERROR');
                }
            }
        } catch (InvalidArgumentException $error) {
            return $this->failure(400, $error->getMessage());
        }
        $id = (string) Str::uuid();
        $quote = DB::transaction(function () use ($id, $payload, $computed, $validUntil, $subject, $operationId, $fingerprint) {
            DB::table('quotes')->insert([
                'id' => $id,
                'order_reference' => (string) $payload['orderReference'],
                'order_number' => (string) $payload['orderNumber'],
                'customer_reference' => (string) $payload['customerReference'],
                'vehicle_reference' => (string) $payload['vehicleReference'],
                'vehicle_plate' => (string) $payload['vehiclePlate'],
                'version_number' => 1,
                'status' => 'pending',
                'subtotal' => $computed['subtotal'],
                'discount_percent' => $computed['discountPercent'],
                'discount_amount' => $computed['discountAmount'],
                'tax_percent' => $computed['taxPercent'],
                'tax_amount' => $computed['taxAmount'],
                'total' => $computed['total'],
                'currency' => 'BOB',
                'notes' => $payload['notes'] ?? null,
                'valid_until' => $validUntil,
                'created_by' => $subject,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->insertItems($id, $computed['items']);
            $view = $this->view((array) DB::table('quotes')->where('id', $id)->first());
            $this->remember($operationId, $fingerprint, $view);
            return $view;
        });
        return response()->json(['quote' => $quote, 'replayed' => false], 201);
    }

    /** CU13: revising a pending quote produces the next version and supersedes the previous one. */
    private function reviseInTransaction(Request $request, string $id): JsonResponse
    {
        $operationId = (string) ($request->json('operationId') ?? '');
        if (!Str::isUuid($operationId)) {
            return $this->failure(400, 'VALIDATION_ERROR');
        }
        $subject = (string) $request->attributes->get('subject');
        $payload = $request->json()->all();
        $fingerprint = hash('sha256', CanonicalJson::encode(['subject' => $subject, 'command' => 'revise', 'id' => $id, 'body' => $payload]));
        if ($replay = $this->replay($operationId, $fingerprint)) {
            return response()->json(['quote' => $replay, 'replayed' => true], 200);
        }
        $current = DB::table('quotes')->where('id', $id)->lockForUpdate()->first();
        if ($current === null) {
            return $this->failure(404, 'QUOTE_NOT_FOUND');
        }
        if ($current->status === 'approved') {
            return $this->failure(409, 'QUOTE_APPROVED_IMMUTABLE');
        }
        if (DB::table('quote_confirmation_links')->where('quote_id', $id)->exists()) {
            return $this->failure(409, 'QUOTE_LINKED_IMMUTABLE');
        }
        if ($current->status === 'rejected' || $current->status === 'superseded') {
            return $this->failure(409, 'QUOTE_NOT_PENDING');
        }
        $expected = $request->json('expectedVersion');
        if (!is_int($expected) || $expected !== (int) $current->version_number) {
            return $this->failure(409, 'VERSION_CONFLICT');
        }
        try {
            $items = $this->items($payload['items'] ?? null);
            $computed = QuotePolicy::calculate($items, (float) ($payload['discountPercent'] ?? 0), (float) ($payload['taxPercent'] ?? $current->tax_percent));
            QuotePolicy::assertConsistent(isset($payload['total']) ? (float) $payload['total'] : null, $computed['total']);
            $validUntil = (string) ($payload['validUntil'] ?? $current->valid_until);
            if (!CivilQuoteCalendar::current($validUntil, now('UTC'))) {
                throw new InvalidArgumentException('VALIDATION_ERROR');
            }
        } catch (InvalidArgumentException $error) {
            return $this->failure(400, $error->getMessage());
        }
        $newId = (string) Str::uuid();
        $quote = DB::transaction(function () use ($current, $newId, $payload, $computed, $validUntil, $subject, $operationId, $fingerprint) {
            DB::table('quotes')->where('id', $current->id)->update(['status' => 'superseded', 'updated_at' => now()]);
            DB::table('quotes')->insert([
                'id' => $newId,
                'order_reference' => $current->order_reference,
                'order_number' => $current->order_number,
                'customer_reference' => $current->customer_reference,
                'vehicle_reference' => $current->vehicle_reference,
                'vehicle_plate' => $current->vehicle_plate,
                'version_number' => (int) $current->version_number + 1,
                'status' => 'pending',
                'subtotal' => $computed['subtotal'],
                'discount_percent' => $computed['discountPercent'],
                'discount_amount' => $computed['discountAmount'],
                'tax_percent' => $computed['taxPercent'],
                'tax_amount' => $computed['taxAmount'],
                'total' => $computed['total'],
                'currency' => 'BOB',
                'notes' => $payload['notes'] ?? $current->notes,
                'valid_until' => $validUntil,
                'created_by' => $subject,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->insertItems($newId, $computed['items']);
            $view = $this->view((array) DB::table('quotes')->where('id', $newId)->first());
            $this->remember($operationId, $fingerprint, $view);
            return $view;
        });
        return response()->json(['quote' => $quote, 'replayed' => false], 200);
    }

    /** CU14: records the client decision with evidence; it never confirms the service. */
    private function decideInTransaction(Request $request, string $id): JsonResponse
    {
        $operationId = (string) ($request->json('operationId') ?? '');
        if (!Str::isUuid($operationId)) {
            return $this->failure(400, 'VALIDATION_ERROR');
        }
        $subject = (string) $request->attributes->get('subject');
        $decision = (string) ($request->json('decision') ?? '');
        $evidence = trim((string) ($request->json('evidence') ?? ''));
        $reason = $request->json('reason');
        $fingerprint = hash('sha256', CanonicalJson::encode(['subject' => $subject, 'command' => 'decide', 'id' => $id, 'body' => $request->json()->all()]));
        if ($replay = $this->replay($operationId, $fingerprint)) {
            return response()->json(['quote' => $replay, 'replayed' => true], 200);
        }
        if (!in_array($decision, ['approved', 'rejected'], true) || $evidence === '' || mb_strlen($evidence) > 300) {
            return $this->failure(400, 'VALIDATION_ERROR');
        }
        $quote = DB::table('quotes')->where('id', $id)->lockForUpdate()->first();
        if ($quote === null) {
            return $this->failure(404, 'QUOTE_NOT_FOUND');
        }
        if ($quote->status !== 'pending') {
            return $this->failure(409, 'QUOTE_ALREADY_DECIDED');
        }
        if (DB::table('quote_confirmation_links')->where('quote_id', $id)->exists()) {
            return $this->failure(409, 'QUOTE_LINKED_IMMUTABLE');
        }
        if (!CivilQuoteCalendar::current((string) $quote->valid_until, now('UTC'))) {
            return $this->failure(409, 'QUOTE_EXPIRED');
        }
        $view = DB::transaction(function () use ($quote, $decision, $evidence, $reason, $subject, $operationId, $fingerprint) {
            DB::table('quote_decisions')->insert([
                'id' => (string) Str::uuid(),
                'quote_id' => $quote->id,
                'decision' => $decision,
                'decided_by' => $subject,
                'evidence' => $evidence,
                'reason' => is_string($reason) ? mb_substr($reason, 0, 300) : null,
                'decided_at' => now(),
            ]);
            DB::table('quotes')->where('id', $quote->id)->update(['status' => $decision, 'updated_at' => now()]);
            $view = $this->view((array) DB::table('quotes')->where('id', $quote->id)->first());
            $this->remember($operationId, $fingerprint, $view);
            return $view;
        });
        return response()->json([
            'quote' => $view,
            'orderStatusHint' => $decision === 'approved' ? 'quote_approved' : 'quote_rejected',
            'replayed' => false,
        ]);
    }

    private function view(array $row): array
    {
        $items = DB::table('quote_items')->where('quote_id', $row['id'])->orderBy('position')->get();
        $decision = DB::table('quote_decisions')->where('quote_id', $row['id'])->first();
        return [
            'id' => $row['id'],
            'orderReference' => $row['order_reference'],
            'orderNumber' => $row['order_number'],
            'customerReference' => $row['customer_reference'],
            'vehicleReference' => $row['vehicle_reference'],
            'vehiclePlate' => $row['vehicle_plate'],
            'version' => (int) $row['version_number'],
            'status' => $row['status'],
            'subtotal' => (float) $row['subtotal'],
            'discountPercent' => (float) $row['discount_percent'],
            'discountAmount' => (float) $row['discount_amount'],
            'taxPercent' => (float) $row['tax_percent'],
            'taxAmount' => (float) $row['tax_amount'],
            'total' => (float) $row['total'],
            'currency' => $row['currency'],
            'notes' => $row['notes'],
            'validUntil' => (string) $row['valid_until'],
            'currencyHint' => 'Los importes son estimados; la aprobación no confirma el servicio.',
            'decision' => $decision === null ? null : [
                'decision' => $decision->decision,
                'decidedBy' => $decision->decided_by,
                'evidence' => $decision->evidence,
                'reason' => $decision->reason,
                'decidedAt' => (string) $decision->decided_at,
            ],
            'items' => $items->map(fn ($item) => [
                'serviceReference' => $item->service_reference,
                'description' => $item->description,
                'quantity' => (int) $item->quantity,
                'unitPrice' => (float) $item->unit_price,
                'lineTotal' => (float) $item->line_total,
            ])->all(),
        ];
    }

    private function items(mixed $raw): array
    {
        if (!is_array($raw) || $raw === []) {
            throw new InvalidArgumentException('QUOTE_ITEMS_INVALID');
        }
        $items = [];
        foreach ($raw as $item) {
            if (!is_array($item)) {
                throw new InvalidArgumentException('QUOTE_ITEMS_INVALID');
            }
            $items[] = [
                'serviceReference' => (string) ($item['serviceReference'] ?? ''),
                'description' => mb_substr((string) ($item['description'] ?? ''), 0, 300),
                'quantity' => (int) ($item['quantity'] ?? 0),
                'unitPrice' => (float) ($item['unitPrice'] ?? -1),
            ];
        }
        return $items;
    }

    private function insertItems(string $quoteId, array $items): void
    {
        $position = 1;
        foreach ($items as $item) {
            DB::table('quote_items')->insert([
                'id' => (string) Str::uuid(),
                'quote_id' => $quoteId,
                'service_reference' => $item['serviceReference'],
                'description' => $item['description'],
                'quantity' => $item['quantity'],
                'unit_price' => $item['unitPrice'],
                'line_total' => $item['lineTotal'],
                'position' => $position++,
            ]);
        }
    }

    private function replay(string $operationId, string $fingerprint): ?array
    {
        $row = DB::table('finance_operations')->where('operation_id', $operationId)->first();
        if ($row === null) {
            return null;
        }
        if ($row->fingerprint !== $fingerprint) {
            abort(409, 'IDEMPOTENCY_CONFLICT');
        }
        $stored = json_decode((string) $row->result, true);
        return is_array($stored) ? $stored : null;
    }

    private function remember(string $operationId, string $fingerprint, array $result): void
    {
        DB::table('finance_operations')->insert([
            'operation_id' => $operationId,
            'fingerprint' => $fingerprint,
            'result' => json_encode($result),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function int(mixed $value, int $fallback, int $min, int $max): int
    {
        if ($value === null || $value === '') {
            return $fallback;
        }
        if (!is_numeric($value) || (int) $value != $value || (int) $value < $min || (int) $value > $max) {
            abort(400, 'VALIDATION_ERROR');
        }
        return (int) $value;
    }

    private function failure(int $status, string $code): JsonResponse
    {
        return response()->json(['statusCode' => $status, 'message' => 'Request failed', 'code' => $code], $status);
    }
}
