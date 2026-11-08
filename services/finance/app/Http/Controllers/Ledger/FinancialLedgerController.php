<?php

namespace App\Http\Controllers\Ledger;

use App\Application\Ledger\FinancialLedger;
use App\Application\Ledger\LedgerError;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class FinancialLedgerController
{
    public function __construct(private readonly FinancialLedger $ledger) {}

    public function payment(Request $r, string $orderId): JsonResponse { return $this->write($r, 'record_payment', $orderId); }
    public function verification(Request $r, string $orderId): JsonResponse { return $this->write($r, 'verify_reference', $orderId); }
    public function expense(Request $r): JsonResponse { return $this->write($r, 'record_expense', 'expenses'); }

    private function write(Request $r, string $action, string $target): JsonResponse
    {
        return $this->respond(function () use ($r, $action, $target) {
            if ($r->query() !== [] || !$r->isJson()) {
                throw new LedgerError('VALIDATION_ERROR', 400);
            }
            $decoded = json_decode($r->getContent());
            if (!$decoded instanceof \stdClass) {
                throw new LedgerError('VALIDATION_ERROR', 400);
            }
            if ($target !== 'expenses') {
                $target = LedgerInput::uuid($target);
            }
            $b = LedgerInput::body($action, $r->json()->all());
            $result = $this->ledger->command($action, $target, $b, $r->attributes->get('ledgerActor'), $r->bearerToken());
            return response()->json($result['body'], $result['status']);
        });
    }

    public function read(Request $r): JsonResponse
    {
        return $this->respond(function () use ($r) {
            if ($r->getContent() !== '') {
                throw new LedgerError('VALIDATION_ERROR', 400);
            }
            $name = $r->route()->getName();
            $query = LedgerInput::query($r->query(), match ($name) {
                'ledger.receivables' => ['status', 'limit', 'offset'],
                'ledger.payments' => ['from', 'to', 'limit', 'offset'],
                'ledger.expenses' => ['from', 'to', 'categoryId', 'limit', 'offset'],
                'ledger.summary' => ['from', 'to'],
                default => [],
            }, $name === 'ledger.summary');
            $id = $r->route('id');
            if ($id !== null) {
                $id = LedgerInput::uuid($id);
            }
            return response()->json(match ($name) {
                'ledger.receivables' => $this->ledger->receivables($query, $r->bearerToken()),
                'ledger.receivable' => $this->ledger->receivable($id, $r->bearerToken()),
                'ledger.payments' => $this->ledger->listing('payments', $query),
                'ledger.receipt' => $this->ledger->receipt($id),
                'ledger.categories' => $this->ledger->categories(),
                'ledger.expenses' => $this->ledger->listing('expenses', $query),
                'ledger.expense' => $this->ledger->expenseDetail($id),
                'ledger.operation' => $this->ledger->operation($id, $r->attributes->get('ledgerActor')),
                'ledger.summary' => $this->ledger->summary($query),
            });
        });
    }

    private function respond(\Closure $work): JsonResponse
    {
        try {
            return $work();
        } catch (LedgerError $e) {
            return response()->json(['statusCode' => $e->status, 'code' => $e->getMessage(), 'message' => 'Request failed', ...$e->details], $e->status);
        } catch (QueryException) {
            return response()->json(['statusCode' => 503, 'code' => 'PERSISTENCE_UNAVAILABLE', 'message' => 'Result could not be confirmed'], 503);
        }
    }
}
