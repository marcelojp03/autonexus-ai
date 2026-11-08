<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('expense_documents', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('owner_subject');
            $t->string('file_name', 160);
            $t->string('content_type', 32);
            $t->unsignedInteger('size_bytes');
            $t->string('sha256', 64);
            $t->string('state', 16);
            $t->string('object_key')->unique();
            $t->text('object_version')->nullable();
            $t->uuid('expense_id')->nullable()->unique();
            $t->string('created_at', 24);
        });
        Schema::create('expense_document_grants', function (Blueprint $t) {
            $t->string('hash', 64)->primary();
            $t->uuid('document_id');
            $t->foreign('document_id')->references('id')->on('expense_documents')->restrictOnDelete();
            $t->string('method', 3);
            $t->text('object_version')->nullable();
            $t->unsignedBigInteger('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('expense_document_grants');
        Schema::dropIfExists('expense_documents');
    }
};
