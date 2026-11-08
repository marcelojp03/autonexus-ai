<?php

namespace App\Console\Commands;

use App\Application\Ledger\DocumentRelocation;
use App\Infrastructure\Ledger\S3DocumentStorage;
use App\Infrastructure\Ledger\SqlDocumentRelocationRepository;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

final class RelocateExpenseDocuments extends Command
{
    protected $signature = 'finance:relocate-documents {mode : prepare, commit or status} {operationId : Stable UUID}
        {--source-profile= : Trusted private source profile file} {--target-profile= : Trusted private target profile file}';
    protected $description = 'Operator-only transfer of private document version pointers; never transfers money';

    public function handle(): int
    {
        $mode = $this->argument('mode');
        $operationId = strtolower($this->argument('operationId'));
        if (!in_array($mode, ['prepare', 'commit', 'status'], true) || !Str::isUuid($operationId)
            || ($mode !== 'status' && !$this->option('target-profile')) || ($mode === 'prepare' && !$this->option('source-profile'))) {
            $this->emit(['event' => 'RELOCATION_ERROR', 'code' => 'RELOCATION_INVALID_ARGUMENTS']);
            return self::INVALID;
        }
        try {
            $service = new DocumentRelocation(new SqlDocumentRelocationRepository);
            if ($mode === 'status') {
                $result = $service->status($operationId);
            } else {
                $target = new S3DocumentStorage($this->option('target-profile'));
                if ($mode === 'prepare') {
                    $source = new S3DocumentStorage($this->option('source-profile'));
                    if (!hash_equals($source->fingerprint(), (new S3DocumentStorage)->fingerprint())) {
                        throw new \RuntimeException('RELOCATION_ACTIVE_PROFILE_MISMATCH');
                    }
                    $result = $service->prepare($operationId, $source, $target, $source->fingerprint(), $target->fingerprint());
                } else {
                    $result = $service->commit($operationId, $target, $target->fingerprint(),
                        fn () => (new S3DocumentStorage)->fingerprint(), function (array $message) {
                            $this->emit($message);
                            $line = fgets(STDIN, 32);
                            return $line === false ? false : rtrim($line, "\r\n");
                        });
                }
            }
            $this->emit($result);
            return $result['position'] === 'mixed' ? self::FAILURE : self::SUCCESS;
        } catch (\Throwable $error) {
            $code = $error->getMessage();
            if (!preg_match('/^RELOCATION_[A-Z_]+$/D', $code)) { $code = 'RELOCATION_UNAVAILABLE'; }
            $this->emit(['event' => 'RELOCATION_ERROR', 'operationId' => $operationId, 'code' => $code, 'nextAction' => 'status']);
            return self::FAILURE;
        }
    }

    private function emit(array $message): void
    {
        $this->output->writeln(json_encode($message, JSON_THROW_ON_ERROR), \Symfony\Component\Console\Output\OutputInterface::OUTPUT_RAW);
        fflush(STDOUT);
    }
}
