<?php

return [
    'paths' => ['health', 'quotes', 'quotes/*'],
    'allowed_methods' => ['GET', 'POST', 'OPTIONS'],
    'allowed_origins' => \App\Support\TransportConfiguration::origins((string) env('WEB_ALLOWED_ORIGINS', 'http://127.0.0.1:4200,http://127.0.0.1:4202,http://127.0.0.1:4204')),
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['Authorization', 'Content-Type'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
