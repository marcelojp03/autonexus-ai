<?php

namespace App\Infrastructure\Ledger;

use App\Application\Ledger\DocumentStorage;
use App\Application\Ledger\LedgerError;
use Illuminate\Support\Facades\Http;

final class S3DocumentStorage implements DocumentStorage
{
    private ?array $trustedProfile = null;

    public function __construct(private readonly ?string $profileFile = null) {}

    public function fingerprint(): string
    {
        $p = $this->profile();
        return hash('sha256', \App\Domain\CanonicalJson::encode([
            'endpoint' => rtrim($p['endpoint'], '/'), 'region' => $p['region'], 'bucket' => $p['bucket'],
            'accessKeyHash' => hash('sha256', $p['accessKey']),
        ]));
    }

    private function profile(): array
    {
        if ($this->trustedProfile !== null) { return $this->trustedProfile; }
        $file = $this->profileFile ?? config('financial-ledger.document_storage_file');
        $raw = is_string($file) && $file !== '' && is_file($file) ? @file_get_contents($file) : false;
        $p = $raw === false ? null : json_decode($raw, true);
        foreach (['endpoint', 'region', 'bucket', 'accessKey', 'secretKey'] as $key) {
            if (!is_array($p) || !is_string($p[$key] ?? null) || $p[$key] === '' || preg_match('/[\r\n]/', $p[$key])) {
                throw new LedgerError('DOCUMENT_STORAGE_UNAVAILABLE', 503);
            }
        }
        $u = parse_url($p['endpoint']);
        if ($u === false || !isset($u['host'], $u['scheme']) || isset($u['user']) || isset($u['pass']) || isset($u['query']) || isset($u['fragment'])
            || !in_array($u['path'] ?? '', ['', '/'], true) || !preg_match('/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/D', $p['bucket'])
            || !preg_match('/^[a-z0-9-]+$/D', $p['region'])
            || ($u['scheme'] !== 'https' && !($u['scheme'] === 'http' && in_array($u['host'], ['localhost', '127.0.0.1', '[::1]'], true)))) {
            throw new LedgerError('DOCUMENT_STORAGE_UNAVAILABLE', 503);
        }
        if ($this->profileFile !== null) { $this->trustedProfile = $p; }
        return $p;
    }

    public function assertConfigured(): void { $this->profile(); }

    public function put(string $key, string $bytes, string $contentType): string
    {
        $response = $this->request('PUT', $key, '', $bytes, ['content-type' => $contentType, 'if-none-match' => '*']);
        if ($response->status() === 412) {
            $response = $this->request('GET', $key);
            if (!hash_equals(hash('sha256', $bytes), hash('sha256', $this->boundedBody($response)))) {
                throw new LedgerError('DOCUMENT_STORAGE_UNAVAILABLE', 503);
            }
        }
        if (!$response->successful() || !is_string($version = $response->header('x-amz-version-id')) || $version === '' || $version === 'null') {
            throw new LedgerError('DOCUMENT_STORAGE_UNAVAILABLE', 503);
        }
        return $version;
    }

    public function get(string $key, string $version): string
    {
        $response = $this->request('GET', $key, $version);
        if (!$response->successful() || $response->header('x-amz-version-id') !== $version) {
            throw new LedgerError('DOCUMENT_STORAGE_UNAVAILABLE', 503);
        }
        return $this->boundedBody($response);
    }

    private function boundedBody(\Illuminate\Http\Client\Response $response): string
    {
        try {
            $stream = $response->toPsrResponse()->getBody();
            $bytes = '';
            while (!$stream->eof()) {
                $chunk = $stream->read(min(65536, 5242881 - strlen($bytes)));
                if ($chunk === '' && !$stream->eof()) { throw new \RuntimeException; }
                $bytes .= $chunk;
                if (strlen($bytes) > 5242880) { throw new \RuntimeException; }
            }
            return $bytes;
        } catch (\Throwable) {
            throw new LedgerError('DOCUMENT_STORAGE_UNAVAILABLE', 503);
        }
    }

    private function request(string $method, string $key, string $version = '', string $body = '', array $headers = []): \Illuminate\Http\Client\Response
    {
        $p = $this->profile();
        $at = gmdate('Ymd\THis\Z');
        $date = substr($at, 0, 8);
        $path = '/'.rawurlencode($p['bucket']).'/'.implode('/', array_map('rawurlencode', explode('/', $key)));
        $query = $version === '' ? '' : 'versionId='.rawurlencode($version);
        $endpoint = rtrim($p['endpoint'], '/');
        $host = parse_url($endpoint, PHP_URL_HOST).(parse_url($endpoint, PHP_URL_PORT) ? ':'.parse_url($endpoint, PHP_URL_PORT) : '');
        $headers = [...$headers, 'host' => $host, 'x-amz-content-sha256' => hash('sha256', $body), 'x-amz-date' => $at];
        ksort($headers);
        $canonicalHeaders = '';
        foreach ($headers as $name => $value) { $canonicalHeaders .= $name.':'.trim($value)."\n"; }
        $signed = implode(';', array_keys($headers));
        $canonical = $method."\n".$path."\n".$query."\n".$canonicalHeaders."\n".$signed."\n".hash('sha256', $body);
        $scope = $date.'/'.$p['region'].'/s3/aws4_request';
        $signingKey = 'AWS4'.$p['secretKey'];
        foreach ([$date, $p['region'], 's3', 'aws4_request'] as $part) { $signingKey = hash_hmac('sha256', $part, $signingKey, true); }
        $signature = hash_hmac('sha256', "AWS4-HMAC-SHA256\n".$at."\n".$scope."\n".hash('sha256', $canonical), $signingKey);
        $headers['authorization'] = 'AWS4-HMAC-SHA256 Credential='.$p['accessKey'].'/'.$scope.', SignedHeaders='.$signed.', Signature='.$signature;
        // Laravel's header merge is case-sensitive; withBody creates "Content-Type".
        // Canonical signing stays lowercase, while this exact wire key replaces its default.
        $headers['Content-Type'] = $headers['content-type'] ?? 'application/octet-stream';
        unset($headers['content-type']);
        try {
            // withBody sets Content-Type too. Replace instead of merging: SigV4 must sign
            // exactly the header values sent on the wire, not one of two MIME values.
            return Http::withBody($body, $headers['Content-Type'])->replaceHeaders($headers)
                ->withoutRedirecting()->connectTimeout(3)->timeout(10)->withOptions(['stream' => true, 'read_timeout' => 10])->send($method, $endpoint.$path.($query === '' ? '' : '?'.$query));
        } catch (\Throwable) {
            throw new LedgerError('DOCUMENT_STORAGE_UNAVAILABLE', 503);
        }
    }
}
