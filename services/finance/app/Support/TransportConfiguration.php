<?php

namespace App\Support;

use InvalidArgumentException;

final class TransportConfiguration
{
    public static function url(string $value, string $name): string
    {
        $url = parse_url($value);
        if (!is_array($url) || !in_array($url['scheme'] ?? '', ['http', 'https'], true) || empty($url['host'])
            || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment'])
            || preg_match('/[\s\\\\*]/', $value)) {
            throw new InvalidArgumentException('Invalid configuration: '.$name);
        }
        return $value;
    }

    public static function audience(string $value): string
    {
        if ($value !== 'autonexus-finance-api') throw new InvalidArgumentException('Invalid configuration: OIDC_AUDIENCE');
        return $value;
    }

    public static function origins(string $value): array
    {
        $origins = array_map('trim', explode(',', $value));
        foreach ($origins as $origin) {
            $url = parse_url(self::url($origin, 'WEB_ALLOWED_ORIGINS'));
            if (isset($url['path'])) throw new InvalidArgumentException('Invalid configuration: WEB_ALLOWED_ORIGINS');
        }
        return array_values(array_unique($origins));
    }

    public static function postgres(string $mode, ?string $ca): array
    {
        if (!in_array($mode, ['disable', 'verify-full'], true)) throw new InvalidArgumentException('Invalid configuration: DB_SSLMODE');
        if ($ca !== null && ($mode !== 'verify-full' || $ca === '' || !is_file($ca) || !is_readable($ca) || str_contains($ca, ';'))) {
            throw new InvalidArgumentException('Invalid configuration: DB_CA_FILE');
        }
        return ['sslmode' => $mode, 'sslrootcert' => $ca];
    }
}
