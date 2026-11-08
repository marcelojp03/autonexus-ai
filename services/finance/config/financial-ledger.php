<?php

return [
    'document_storage_file' => env('FINANCE_DOCUMENT_STORAGE_FILE'),
    'operations_url' => \App\Support\TransportConfiguration::url((string) env('OPERATIONS_API_URL', 'http://127.0.0.1:8081'), 'OPERATIONS_API_URL'),
    'methods' => ['cash', 'bank_transfer', 'qr'],
];
