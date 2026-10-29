<?php

use App\Http\Controllers\QuoteController;
use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => response()->json(['status' => 'UP']));
Route::get('/health/ready', function () {
    try {
        \Illuminate\Support\Facades\DB::select('SELECT 1');
        return response()->json(['status' => 'UP']);
    } catch (\Throwable) {
        return response()->json(['status' => 'DOWN'], 503);
    }
});

Route::prefix('internal/cu15')->group(function () {
    Route::post('/quote-links/{sagaId}/authorize', [\App\Http\Controllers\QuoteLinkController::class, 'authorize'])->middleware('cu15-auth:authorize');
    Route::post('/quote-links/{sagaId}/cancel', [\App\Http\Controllers\QuoteLinkController::class, 'cancel'])->middleware('cu15-auth:cancel');
    Route::get('/quote-links/{sagaId}', [\App\Http\Controllers\QuoteLinkController::class, 'show'])->middleware('cu15-auth:read');
    Route::get('/operations/{operationId}', [\App\Http\Controllers\QuoteLinkController::class, 'operation'])->middleware('cu15-auth:read');
});

Route::middleware('finance-auth:quotes.read')->group(function () {
    Route::get('/quotes', [QuoteController::class, 'index']);
    Route::get('/quotes/{id}', [QuoteController::class, 'show']);
});

Route::middleware('finance-auth:quotes.write')->group(function () {
    Route::post('/quotes', [QuoteController::class, 'store']);
    Route::post('/quotes/{id}/revisions', [QuoteController::class, 'revise']);
});

Route::middleware('finance-auth:quotes.decide')->post('/quotes/{id}/decision', [QuoteController::class, 'decide']);
