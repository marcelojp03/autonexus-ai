<?php

namespace App\Application\Ledger;

interface DocumentStorage
{
    public function assertConfigured(): void;
    public function put(string $key, string $bytes, string $contentType): string;
    public function get(string $key, string $version): string;
}
