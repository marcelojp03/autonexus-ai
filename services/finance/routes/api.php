<?php

use App\Http\Controllers\QuoteController;
use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => response()->json(['status' => 'UP']));

Route::middleware('finance-auth:quotes.read')->group(function () {
    Route::get('/quotes', [QuoteController::class, 'index']);
    Route::get('/quotes/{id}', [QuoteController::class, 'show']);
});

Route::middleware('finance-auth:quotes.write')->group(function () {
    Route::post('/quotes', [QuoteController::class, 'store']);
    Route::post('/quotes/{id}/revisions', [QuoteController::class, 'revise']);
});

Route::middleware('finance-auth:quotes.decide')->post('/quotes/{id}/decision', [QuoteController::class, 'decide']);
