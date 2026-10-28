<?php

namespace App\Support;

use RuntimeException;

/**
 * Validates Keycloak access tokens with OpenSSL and the realm JWKS.
 * No token is ever copied to storage or logs.
 */
final class JwtVerifier
{
    public function __construct(
        private readonly string $issuer,
        private readonly string $audience,
        private readonly int $tolerance = 5,
    ) {
    }

    /** @return array{sub: string, roles: list<string>} */
    public function verify(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new RuntimeException('invalid-token');
        }
        [$header, $payload, $signature] = $parts;
        $head = json_decode($this->base64UrlDecode($header), true);
        $claims = json_decode($this->base64UrlDecode($payload), true);
        if (!is_array($head) || !is_array($claims) || ($head['alg'] ?? '') !== 'RS256') {
            throw new RuntimeException('invalid-token');
        }
        $key = $this->key($head['kid'] ?? null);
        $valid = openssl_verify($header.'.'.$payload, $this->base64UrlDecode($signature), $key, OPENSSL_ALGO_SHA256);
        if ($valid !== 1) {
            throw new RuntimeException('invalid-signature');
        }
        $now = time();
        if (($claims['iss'] ?? null) !== $this->issuer) {
            throw new RuntimeException('invalid-issuer');
        }
        $audiences = $claims['aud'] ?? [];
        if (!in_array($this->audience, is_array($audiences) ? $audiences : [$audiences], true)) {
            throw new RuntimeException('invalid-audience');
        }
        if (($claims['typ'] ?? null) !== 'Bearer' || empty($claims['sub'])) {
            throw new RuntimeException('invalid-token');
        }
        if (!isset($claims['exp']) || $now > ((int) $claims['exp'] + $this->tolerance)) {
            throw new RuntimeException('expired');
        }
        if (isset($claims['nbf']) && $now + $this->tolerance < (int) $claims['nbf']) {
            throw new RuntimeException('not-yet-valid');
        }
        $roles = $claims['realm_access']['roles'] ?? [];
        return [
            'sub' => (string) $claims['sub'],
            'roles' => is_array($roles) ? array_values(array_filter($roles, 'is_string')) : [],
        ];
    }

    private function key(?string $kid): string
    {
        $jwks = $this->jwks();
        foreach ($jwks['keys'] ?? [] as $jwk) {
            if ($kid === null || ($jwk['kid'] ?? null) === $kid) {
                return $this->pem($jwk);
            }
        }
        throw new RuntimeException('unknown-key');
    }

    private function jwks(): array
    {
        $file = storage_path('app/jwks.json');
        if (is_file($file) && filemtime($file) > time() - 600) {
            $cached = json_decode((string) file_get_contents($file), true);
            if (is_array($cached) && isset($cached['keys'])) {
                return $cached;
            }
        }
        $context = stream_context_create(['http' => ['timeout' => 2]]);
        $body = @file_get_contents($this->issuer.'/protocol/openid-connect/certs', false, $context);
        if (!is_string($body)) {
            throw new RuntimeException('jwks-unavailable');
        }
        $decoded = json_decode($body, true);
        if (!is_array($decoded) || !isset($decoded['keys'])) {
            throw new RuntimeException('jwks-invalid');
        }
        @file_put_contents($file, $body);
        return $decoded;
    }

    private function pem(array $jwk): string
    {
        if (($jwk['kty'] ?? '') !== 'RSA' || !isset($jwk['n'], $jwk['e'])) {
            throw new RuntimeException('unsupported-key');
        }
        $modulus = $this->base64UrlDecode($jwk['n']);
        $exponent = $this->base64UrlDecode($jwk['e']);
        $rsaPublicKey = $this->sequence($this->integer($modulus).$this->integer($exponent));
        $algorithm = $this->sequence($this->oid('1.2.840.113549.1.1.1')."\x05\x00");
        $subjectPublicKeyInfo = $this->sequence($algorithm.$this->bitString($rsaPublicKey));
        return "-----BEGIN PUBLIC KEY-----\n"
            .chunk_split(base64_encode($subjectPublicKeyInfo), 64, "\n")
            ."-----END PUBLIC KEY-----\n";
    }

    private function sequence(string $value): string
    {
        return "\x30".$this->length(strlen($value)).$value;
    }

    private function integer(string $value): string
    {
        $value = ltrim($value, "\x00");
        if ($value === '' || ord($value[0]) > 0x7f) {
            $value = "\x00".$value;
        }
        return "\x02".$this->length(strlen($value)).$value;
    }

    private function bitString(string $value): string
    {
        return "\x03".$this->length(strlen($value) + 1)."\x00".$value;
    }

    private function oid(string $oid): string
    {
        $parts = array_map('intval', explode('.', $oid));
        $body = chr($parts[0] * 40 + $parts[1]);
        foreach (array_slice($parts, 2) as $part) {
            $encoded = chr($part & 0x7f);
            $part >>= 7;
            while ($part > 0) {
                $encoded = chr(0x80 | ($part & 0x7f)).$encoded;
                $part >>= 7;
            }
            $body .= $encoded;
        }
        return "\x06".$this->length(strlen($body)).$body;
    }

    private function length(int $length): string
    {
        if ($length < 0x80) {
            return chr($length);
        }
        $bytes = '';
        while ($length > 0) {
            $bytes = chr($length & 0xff).$bytes;
            $length >>= 8;
        }
        return chr(0x80 | strlen($bytes)).$bytes;
    }

    private function base64UrlDecode(string $value): string
    {
        $decoded = base64_decode(strtr($value, '-_', '+/'), true);
        if ($decoded === false) {
            throw new RuntimeException('invalid-token');
        }
        return $decoded;
    }
}
