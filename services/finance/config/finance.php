<?php

return [
    'issuer' => \App\Support\TransportConfiguration::url((string) env('OIDC_ISSUER_URI', 'http://127.0.0.1:8180/realms/autonexus'), 'OIDC_ISSUER_URI'),
    'jwks_uri' => \App\Support\TransportConfiguration::url((string) env('OIDC_JWKS_URI', 'http://127.0.0.1:8180/realms/autonexus/protocol/openid-connect/certs'), 'OIDC_JWKS_URI'),
    'audience' => \App\Support\TransportConfiguration::audience((string) env('OIDC_AUDIENCE', 'autonexus-finance-api')),
    'employees_url' => \App\Support\TransportConfiguration::url((string) env('EMPLOYEES_API_URL', 'http://127.0.0.1:3002'), 'EMPLOYEES_API_URL'),
];
