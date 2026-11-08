<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('financial_ledger_locks', function (Blueprint $t) {
            $t->string('key', 160)->primary();
        });
        foreach (['obligations', 'payments', 'receipts', 'verifications', 'expenses', 'categories', 'operations', 'audit'] as $name) {
            Schema::create('financial_'.$name, function (Blueprint $t) use ($name) {
                $t->string('id', 64)->primary();
                $t->json('record');
                if ($name === 'receipts') {
                    $t->uuid('receipt_id')->unique();
                    $t->string('receipt_number', 64)->unique();
                }
            });
        }
        foreach (['utilities' => 'Servicios básicos', 'tools' => 'Herramientas', 'equipment_maintenance' => 'Mantenimiento de equipos', 'administrative' => 'Administrativos', 'other' => 'Otros'] as $code => $name) {
            $ids = ['utilities' => '9fb97000-0000-4000-8000-000000000001', 'tools' => '9fb97000-0000-4000-8000-000000000002', 'equipment_maintenance' => '9fb97000-0000-4000-8000-000000000003', 'administrative' => '9fb97000-0000-4000-8000-000000000004', 'other' => '9fb97000-0000-4000-8000-000000000005'];
            DB::table('financial_categories')->insert(['id' => $ids[$code], 'record' => json_encode(['id' => $ids[$code], 'code' => $code, 'name' => $name, 'active' => true], JSON_THROW_ON_ERROR)]);
        }
    }

    public function down(): void
    {
        foreach (['audit', 'operations', 'categories', 'expenses', 'verifications', 'receipts', 'payments', 'obligations'] as $name) {
            Schema::dropIfExists('financial_'.$name);
        }
        Schema::dropIfExists('financial_ledger_locks');
    }
};
