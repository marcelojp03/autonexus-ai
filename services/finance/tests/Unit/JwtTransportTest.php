<?php

namespace Tests\Unit;

use App\Support\JwtVerifier;
use Illuminate\Foundation\Application;
use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class JwtTransportTest extends TestCase
{
    public function test_public_issuer_is_exact_and_independent_of_internal_jwks(): void
    {
        $previous = Container::getInstance();
        $directory = sys_get_temp_dir().'/finance-jwt-'.bin2hex(random_bytes(8));
        mkdir($directory.'/app', 0700, true);
        $application = new Application($directory);
        $application->useStoragePath($directory);
        $issuer = 'https://workshop.test/identity/realms/autonexus';
        $jwks = 'http://keycloak:8080/identity/realms/autonexus/protocol/openid-connect/certs';
        $cache = $directory.'/app/jwks-'.hash('sha256', $issuer.'|'.$jwks).'.json';
        try {
            file_put_contents($directory.'/openssl.cnf', "[req]\ndistinguished_name = req_distinguished_name\n[req_distinguished_name]\n");
            $key = openssl_pkey_new(['config' => $directory.'/openssl.cnf', 'private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
            $details = openssl_pkey_get_details($key);
            file_put_contents($cache, json_encode(['keys' => [['kid' => 'synthetic', 'kty' => 'RSA', 'n' => $this->base64($details['rsa']['n']), 'e' => $this->base64($details['rsa']['e'])]]]));
            $verifier = new JwtVerifier($issuer, 'autonexus-finance-api', jwksUri: $jwks);
            $claims = ['iss' => $issuer, 'aud' => 'autonexus-finance-api', 'sub' => 'synthetic-subject', 'exp' => time() + 60, 'typ' => 'Bearer'];
            $sign = function (array $claims) use ($key): string {
                $message = $this->base64(json_encode(['alg' => 'RS256', 'kid' => 'synthetic', 'jku' => 'http://untrusted.test/certs'])).'.'.$this->base64(json_encode($claims));
                openssl_sign($message, $signature, $key, OPENSSL_ALGO_SHA256);
                return $message.'.'.$this->base64($signature);
            };
            $this->assertSame('synthetic-subject', $verifier->verify($sign($claims))['sub']);
            foreach ([$issuer.'/', 'http://keycloak:8080/identity/realms/autonexus'] as $wrongIssuer) {
                try { $verifier->verify($sign([...$claims, 'iss' => $wrongIssuer])); $this->fail('Foreign issuer accepted'); }
                catch (RuntimeException $error) { $this->assertSame('invalid-issuer', $error->getMessage()); }
            }
            try { $verifier->verify($sign([...$claims, 'aud' => 'autonexus-shell'])); $this->fail('Foreign audience accepted'); }
            catch (RuntimeException $error) { $this->assertSame('invalid-audience', $error->getMessage()); }
        } finally {
            Container::setInstance($previous);
            if (is_file($cache)) unlink($cache);
            if (is_file($directory.'/openssl.cnf')) unlink($directory.'/openssl.cnf');
            rmdir($directory.'/app');
            rmdir($directory);
        }
    }

    private function base64(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }
}
