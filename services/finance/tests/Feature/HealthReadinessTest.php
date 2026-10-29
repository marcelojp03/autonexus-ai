<?php

namespace Tests\Feature;

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class HealthReadinessTest extends TestCase
{
    private string $environmentDirectory;

    public function createApplication()
    {
        $this->environmentDirectory = sys_get_temp_dir().'/finance-health-'.bin2hex(random_bytes(8));
        mkdir($this->environmentDirectory, 0700);
        $app = require dirname(__DIR__, 2).'/bootstrap/app.php';
        $app->useEnvironmentPath($this->environmentDirectory);
        $this->traitsUsedByTest = array_flip(class_uses_recursive(static::class));
        $app->make(Kernel::class)->bootstrap();
        return $app;
    }

    protected function tearDown(): void
    {
        parent::tearDown();
        rmdir($this->environmentDirectory);
    }

    public function test_liveness_never_queries_database(): void
    {
        DB::shouldReceive('select')->never();
        $this->getJson('/health')->assertOk()->assertExactJson(['status' => 'UP']);
    }

    public function test_readiness_probes_owner_database(): void
    {
        DB::shouldReceive('select')->once()->with('SELECT 1')->andReturn([(object) ['?column?' => 1]]);
        $this->getJson('/health/ready')->assertOk()->assertExactJson(['status' => 'UP']);
    }

    public function test_database_failure_is_sanitized_and_unavailable(): void
    {
        DB::shouldReceive('select')->once()->with('SELECT 1')->andThrow(new \RuntimeException('private-host private-user secret SQL'));
        $this->getJson('/health/ready')->assertStatus(503)->assertExactJson(['status' => 'DOWN']);
    }
}
