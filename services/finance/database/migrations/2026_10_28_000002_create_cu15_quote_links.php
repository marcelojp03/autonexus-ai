<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quote_confirmation_links', function (Blueprint $table) {
            $table->uuid('saga_id')->primary();
            $table->uuid('id')->nullable()->unique();
            $table->uuid('order_id')->nullable();
            $table->uuid('quote_id')->nullable();
            $table->foreign('quote_id')->references('id')->on('quotes')->restrictOnDelete();
            $table->unsignedInteger('quote_version')->nullable();
            $table->string('status', 16);
            $table->unsignedInteger('version');
            $table->timestampTz('authorized_at', 3)->nullable();
            $table->date('valid_until')->nullable();
            $table->jsonb('approval_snapshot')->nullable();
            $table->string('initiated_by', 255);
            $table->timestampTz('initiation_authorized_at', 3);
            $table->timestampTz('cancelled_at', 3)->nullable();
            $table->string('cancel_reason', 64)->nullable();
            $table->jsonb('resource');
        });
        DB::statement("CREATE UNIQUE INDEX cu15_active_order ON quote_confirmation_links(order_id) WHERE status = 'active'");
        DB::statement("CREATE UNIQUE INDEX cu15_active_quote ON quote_confirmation_links(quote_id, quote_version) WHERE status = 'active'");
        DB::statement("ALTER TABLE quote_confirmation_links ADD CONSTRAINT cu15_link_state CHECK (status IN ('active','cancelled') AND version > 0 AND ((id IS NOT NULL AND quote_id IS NOT NULL AND order_id IS NOT NULL AND quote_version > 0 AND authorized_at IS NOT NULL AND valid_until IS NOT NULL AND approval_snapshot IS NOT NULL) OR (status = 'cancelled' AND id IS NULL AND quote_id IS NULL AND order_id IS NULL)))");
        Schema::create('cu15_operations', function (Blueprint $table) {
            $table->uuid('operation_id')->primary();
            $table->uuid('saga_id')->index();
            $table->string('command', 32);
            $table->string('fingerprint', 64);
            $table->string('outcome', 16);
            $table->jsonb('result');
            $table->timestampTz('committed_at', 3);
        });
        Schema::create('cu15_audit', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('operation_id')->unique();
            $table->uuid('saga_id')->index();
            $table->string('command', 32);
            $table->string('outcome', 16);
            $table->string('error_code', 64)->nullable();
            $table->string('initiated_by', 255);
            $table->string('executed_by', 64);
            $table->timestampTz('authorized_at', 3);
            $table->timestampTz('committed_at', 3);
        });
        Schema::create('cu15_outbox', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('event_type', 96);
            $table->string('aggregate_type', 64);
            $table->uuid('aggregate_id');
            $table->unsignedInteger('aggregate_version');
            $table->uuid('saga_id');
            $table->uuid('causation_id');
            $table->jsonb('payload');
            $table->timestampTz('occurred_at', 3);
            $table->unsignedInteger('attempts')->default(0);
            $table->timestampTz('next_attempt_at', 3);
            $table->uuid('lease_owner')->nullable();
            $table->timestampTz('lease_until', 3)->nullable();
            $table->timestampTz('published_at', 3)->nullable();
            $table->string('last_error_code', 64)->nullable();
            $table->index(['published_at', 'next_attempt_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cu15_outbox');
        Schema::dropIfExists('cu15_audit');
        Schema::dropIfExists('cu15_operations');
        Schema::dropIfExists('quote_confirmation_links');
    }
};
