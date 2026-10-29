<?php

// Verification only: independent real PHP kernels/PG connections, no second
// listener or in-memory repository. The token is piped on stdin, never argv.
try {
    $input = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);
    if (!is_string($input['path'] ?? null) || !str_starts_with($input['path'], '/internal/cu15/quote-links/') || !str_ends_with($input['path'], '/authorize')) {
        throw new RuntimeException('Invalid verification route');
    }
    $directory = dirname(__DIR__, 2).'/services/finance';
    define('LARAVEL_START', microtime(true));
    require $directory.'/vendor/autoload.php';
    $app = require $directory.'/bootstrap/app.php';
    $kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
    $kernel->bootstrap();
    Illuminate\Support\Facades\DB::statement("SET application_name = 'cu15-finance-concurrency'");
    $request = Illuminate\Http\Request::create($input['path'], 'POST', [], [], [], [
        'CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json',
        'HTTP_AUTHORIZATION' => 'Bearer '.$input['token'],
    ], json_encode($input['body'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    $response = $kernel->handle($request);
    echo json_encode(['status' => $response->getStatusCode(), 'body' => json_decode($response->getContent(), true, 64, JSON_THROW_ON_ERROR)], JSON_THROW_ON_ERROR);
    $kernel->terminate($request, $response);
} catch (Throwable) {
    echo json_encode(['status' => 500, 'body' => ['code' => 'VERIFICATION_KERNEL_FAILED']]);
    exit(1);
}
