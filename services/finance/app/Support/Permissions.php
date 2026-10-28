<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Resolves the caller permissions from the Employees owner (CU02 catalog).
 * The service never reads another schema; an unavailable owner yields no permissions.
 */
final class Permissions
{
    public function __construct(private readonly string $employeesUrl)
    {
    }

    /** @return list<string> */
    public function for(string $token, string $subject, array $roles): array
    {
        sort($roles);
        $key = 'perm:'.sha1($subject.'|'.implode(',', $roles));
        $cached = Cache::get($key);
        if (is_array($cached)) {
            return $cached;
        }
        try {
            $response = Http::withToken($token)
                ->timeout(2)
                ->acceptJson()
                ->get(rtrim($this->employeesUrl, '/').'/security/permissions');
            $effective = $response->successful() ? ($response->json('effective') ?? []) : [];
        } catch (\Throwable) {
            $effective = [];
        }
        $permissions = array_values(array_filter(is_array($effective) ? $effective : [], 'is_string'));
        Cache::put($key, $permissions, 30);
        return $permissions;
    }
}
