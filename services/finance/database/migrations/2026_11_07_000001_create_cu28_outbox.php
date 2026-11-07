<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cu28_outbox', function (Blueprint $table) {
            $table->uuid('event_id')->primary();
            $table->uuid('quote_id');
            $table->unsignedInteger('quote_version');
            $table->string('event_type', 64);
            $table->json('payload');
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('next_attempt_at');
            $table->uuid('lease_owner')->nullable();
            $table->timestamp('lease_until')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamp('suppressed_at')->nullable();
            $table->timestamp('abandoned_at')->nullable();
            $table->string('last_error_code', 64)->nullable();
            $table->timestamp('created_at');
            $table->unique(['quote_id', 'quote_version', 'event_type']);
            $table->index('next_attempt_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cu28_outbox');
    }
};
