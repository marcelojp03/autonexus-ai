<?php

use App\Http\Middleware\AuthenticateFinance;
use App\Support\JwtVerifier;
use App\Support\Permissions;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        apiPrefix: '',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias(['finance-auth' => AuthenticateFinance::class, 'cu15-auth' => \App\Http\Middleware\AuthenticateCu15::class]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // Business failures keep a stable code; internals never reach the client.
        $exceptions->render(function (Throwable $error, Request $request) {
            if ($error instanceof \App\Application\Cu15\ProtocolError) {
                $status = $error->getMessage() === 'IDEMPOTENCY_CONFLICT' ? 409 : 404;
                return response()->json(['statusCode' => $status, 'message' => 'Request failed', 'code' => $error->getMessage()], $status);
            }
            if ($error instanceof HttpExceptionInterface) {
                $status = $error->getStatusCode();
                $messages = [400 => 'Invalid request', 401 => 'Unauthorized', 403 => 'Forbidden', 404 => 'Record not found', 409 => 'Operation conflict'];
                return response()->json([
                    'statusCode' => $status,
                    'message' => $messages[$status] ?? 'Request failed',
                    'code' => $error->getMessage() !== '' ? $error->getMessage() : 'ERROR',
                ], $status);
            }
            report($error);
            return response()->json(['statusCode' => 500, 'message' => 'Request failed', 'code' => 'INTERNAL_ERROR'], 500);
        });
    })->create();
