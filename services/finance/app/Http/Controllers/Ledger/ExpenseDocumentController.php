<?php

namespace App\Http\Controllers\Ledger;

use App\Application\Ledger\ExpenseDocuments;
use App\Application\Ledger\LedgerError;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class ExpenseDocumentController
{
    public function __construct(private readonly ExpenseDocuments $documents) {}

    public function requestUpload(Request $request): Response
    {
        return $this->respond(function () use ($request) {
            $b = $this->body($request, ['operationId', 'fileName', 'contentType', 'sizeBytes', 'sha256']);
            if (!is_string($b['fileName']) || mb_strlen($b['fileName']) < 1 || mb_strlen($b['fileName']) > 160 || preg_match('/[\x00-\x1f\x7f\/\\\\]/u', $b['fileName'])
                || !is_int($b['sizeBytes']) || $b['sizeBytes'] < 1 || $b['sizeBytes'] > 5242880
                || !is_string($b['sha256']) || !preg_match('/^[a-fA-F0-9]{64}$/D', $b['sha256'])) { throw new LedgerError('VALIDATION_ERROR', 400); }
            if (!in_array($b['contentType'], ['image/jpeg', 'image/png'], true)) { throw new LedgerError('DOCUMENT_TYPE_NOT_ALLOWED', 400); }
            $b['sha256'] = strtolower($b['sha256']);
            $result = $this->documents->command('request_document', $b, $request->attributes->get('ledgerActor'));
            return response()->json($result['body'], $result['status']);
        });
    }

    public function confirm(Request $request, string $id): Response
    {
        return $this->respond(function () use ($request, $id) {
            $b = [...$this->body($request, ['operationId']), 'documentId' => LedgerInput::uuid($id)];
            $result = $this->documents->command('confirm_document', $b, $request->attributes->get('ledgerActor'));
            return response()->json($result['status'] === 200 ? $result['body']['document'] : $result['body'], $result['status']);
        });
    }

    public function download(Request $request, string $id): Response
    {
        return $this->respond(function () use ($request, $id) {
            if ($request->query() !== [] || $request->getContent() !== '') { throw new LedgerError('VALIDATION_ERROR', 400); }
            return response()->json($this->documents->download(LedgerInput::uuid($id), $request->attributes->get('ledgerActor')));
        });
    }

    public function content(Request $request, string $id): Response
    {
        return $this->respond(function () use ($request, $id) {
            if ($request->query() !== [] || $request->headers->has('Authorization') || $request->headers->has('Cookie')) { throw new LedgerError('VALIDATION_ERROR', 400); }
            $length = $request->header('Content-Length');
            if ($request->isMethod('PUT') && (!is_string($length) || !ctype_digit($length) || (int) $length < 1 || (int) $length > 5242880)) { throw new LedgerError('VALIDATION_ERROR', 400); }
            $bytes = $request->getContent();
            if (strlen($bytes) > 5242880 || ($request->isMethod('GET') && $bytes !== '')) { throw new LedgerError('VALIDATION_ERROR', 400); }
            $result = $this->documents->content(LedgerInput::uuid($id), $request->header('X-Finance-Grant', ''), $request->method(), $bytes, $request->header('Content-Type'));
            return $request->isMethod('PUT') ? response('', 204, ['Cache-Control' => 'no-store'])
                : response($result['bytes'], 200, ['Content-Type' => $result['contentType'], 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff', 'Content-Disposition' => 'attachment']);
        });
    }

    private function body(Request $request, array $keys): array
    {
        $decoded = json_decode($request->getContent());
        if (!$request->isJson() || $request->query() !== [] || !$decoded instanceof \stdClass) { throw new LedgerError('VALIDATION_ERROR', 400); }
        $body = $request->json()->all();
        if (array_diff(array_keys($body), $keys) !== [] || array_diff($keys, array_keys($body)) !== []) { throw new LedgerError('VALIDATION_ERROR', 400); }
        $body['operationId'] = LedgerInput::uuid($body['operationId']);
        return $body;
    }

    private function respond(\Closure $work): Response
    {
        try { return $work(); }
        catch (LedgerError $e) { return response()->json(['statusCode' => $e->status, 'code' => $e->getMessage(), 'message' => 'Request failed'], $e->status); }
        catch (QueryException) { return response()->json(['statusCode' => 503, 'code' => 'PERSISTENCE_UNAVAILABLE', 'message' => 'Result could not be confirmed'], 503); }
    }
}
