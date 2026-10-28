<?php

return [
    'issuer' => env('OIDC_ISSUER_URI', 'http://127.0.0.1:8180/realms/autonexus'),
    'audience' => env('OIDC_AUDIENCE', 'autonexus-finance-api'),
    'employees_url' => env('EMPLOYEES_API_URL', 'http://127.0.0.1:3002'),
];
