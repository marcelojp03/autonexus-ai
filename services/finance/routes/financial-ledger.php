<?php

use App\Http\Controllers\Ledger\FinancialLedgerController as Ledger;
use App\Http\Middleware\AuthenticateFinancialLedger as Auth;
use Illuminate\Support\Facades\Route;

foreach ([
    ['/receivables', 'receivables', 'payments.read'],
    ['/receivables/{id}', 'receivable', 'payments.read'],
    ['/payments', 'payments', 'payments.read'],
    ['/payments/{id}/receipt', 'receipt', 'payments.read'],
    ['/expense-categories', 'categories', 'expenses.read'],
    ['/expenses', 'expenses', 'expenses.read'],
    ['/expenses/{id}', 'expense', 'expenses.read'],
    ['/financial-operations/{id}', 'operation', ''],
    ['/financial-summary', 'summary', 'payments.read|expenses.read'],
] as [$path, $name, $permission]) {
    Route::get($path, [Ledger::class, 'read'])->name('ledger.'.$name)->middleware(Auth::class.':'.$permission);
}
Route::post('/orders/{orderId}/payments', [Ledger::class, 'payment'])->middleware(Auth::class.':payments.write');
Route::post('/orders/{orderId}/payment-reference-verifications', [Ledger::class, 'verification'])->middleware(Auth::class.':payments.write');
Route::post('/expenses', [Ledger::class, 'expense'])->middleware(Auth::class.':expenses.write');

Route::post('/expense-documents', [\App\Http\Controllers\Ledger\ExpenseDocumentController::class, 'requestUpload'])->middleware(Auth::class.':expenses.write');
Route::post('/expense-documents/{id}/confirm', [\App\Http\Controllers\Ledger\ExpenseDocumentController::class, 'confirm'])->middleware(Auth::class.':expenses.write');
Route::get('/expense-documents/{id}/download', [\App\Http\Controllers\Ledger\ExpenseDocumentController::class, 'download'])->middleware(Auth::class.':expenses.read');
Route::match(['GET', 'PUT'], '/finance-files/documents/{id}/content', [\App\Http\Controllers\Ledger\ExpenseDocumentController::class, 'content']);
