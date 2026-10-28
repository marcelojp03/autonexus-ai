<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quotes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('order_reference', 64);
            $table->string('order_number', 32);
            $table->string('customer_reference', 64);
            $table->string('vehicle_reference', 64);
            $table->string('vehicle_plate', 16);
            $table->unsignedInteger('version_number');
            $table->string('status', 16);
            $table->decimal('subtotal', 12, 2);
            $table->decimal('discount_percent', 5, 2);
            $table->decimal('discount_amount', 12, 2);
            $table->decimal('tax_percent', 5, 2);
            $table->decimal('tax_amount', 12, 2);
            $table->decimal('total', 12, 2);
            $table->string('currency', 3)->default('BOB');
            $table->text('notes')->nullable();
            $table->date('valid_until');
            $table->string('created_by', 64);
            $table->timestamps();
            $table->unique(['order_reference', 'version_number']);
            $table->index(['order_reference', 'status']);
        });

        Schema::create('quote_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('quote_id');
            $table->string('service_reference', 64);
            $table->string('description', 300);
            $table->unsignedInteger('quantity');
            $table->decimal('unit_price', 10, 2);
            $table->decimal('line_total', 12, 2);
            $table->unsignedInteger('position');
            $table->foreign('quote_id')->references('id')->on('quotes')->cascadeOnDelete();
            $table->unique(['quote_id', 'service_reference']);
        });

        Schema::create('quote_decisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('quote_id');
            $table->string('decision', 16);
            $table->string('decided_by', 64);
            $table->string('evidence', 300);
            $table->string('reason', 300)->nullable();
            $table->timestamp('decided_at');
            $table->foreign('quote_id')->references('id')->on('quotes')->cascadeOnDelete();
            $table->unique('quote_id');
        });

        Schema::create('finance_operations', function (Blueprint $table) {
            $table->uuid('operation_id')->primary();
            $table->string('fingerprint', 64);
            $table->json('result');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('finance_operations');
        Schema::dropIfExists('quote_decisions');
        Schema::dropIfExists('quote_items');
        Schema::dropIfExists('quotes');
    }
};
