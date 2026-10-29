<?php

namespace Tests\Unit;

use App\Support\TransportConfiguration as Transport;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

final class TransportConfigurationTest extends TestCase
{
    public function test_trusted_dns_and_exact_origins(): void
    {
        $this->assertSame('http://employees:3002', Transport::url('http://employees:3002', 'EMPLOYEES_API_URL'));
        $this->assertSame(['https://workshop.test'], Transport::origins('https://workshop.test'));
        $this->assertSame('https://workshop.test/identity/realms/autonexus', Transport::url('https://workshop.test/identity/realms/autonexus', 'OIDC_ISSUER_URI'));
    }

    public function test_credentials_queries_fragments_and_non_http_are_rejected(): void
    {
        foreach (['http://u:p@employees', 'http://employees?x=1', 'http://employees#x', 'http://employees?', 'http://employees#', 'file:///employees', 'http://*'] as $url) {
            try { Transport::url($url, 'DEPENDENCY'); $this->fail('Unsafe URL accepted'); }
            catch (InvalidArgumentException $error) { $this->assertSame('Invalid configuration: DEPENDENCY', $error->getMessage()); }
        }
    }

    public function test_non_origins_and_foreign_audience_are_rejected(): void
    {
        foreach (['*', 'https://workshop.test/path', 'https://workshop.test/', '', 'https://u:p@workshop.test'] as $origin) {
            try { Transport::origins($origin); $this->fail('Non-origin accepted'); }
            catch (InvalidArgumentException $error) { $this->assertSame('Invalid configuration: WEB_ALLOWED_ORIGINS', $error->getMessage()); }
        }
        $this->expectException(InvalidArgumentException::class);
        Transport::audience('autonexus-shell');
    }

    public function test_postgres_uses_only_native_disable_or_verify_full(): void
    {
        $this->assertSame(['sslmode' => 'disable', 'sslrootcert' => null], Transport::postgres('disable', null));
        $this->assertSame(['sslmode' => 'verify-full', 'sslrootcert' => null], Transport::postgres('verify-full', null));
        $this->assertSame(['sslmode' => 'verify-full', 'sslrootcert' => __FILE__], Transport::postgres('verify-full', __FILE__));
        foreach (['prefer', 'require', 'verify-ca'] as $mode) {
            try { Transport::postgres($mode, null); $this->fail('Unverified TLS mode accepted'); }
            catch (InvalidArgumentException $error) { $this->assertSame('Invalid configuration: DB_SSLMODE', $error->getMessage()); }
        }
        $this->expectException(InvalidArgumentException::class);
        Transport::postgres('disable', __FILE__);
    }
}
