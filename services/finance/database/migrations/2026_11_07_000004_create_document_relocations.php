<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('expense_document_relocations', function (Blueprint $t) {
            $t->uuid('operation_id')->primary();
            $t->string('source_fingerprint', 64);
            $t->string('target_fingerprint', 64);
            $t->string('state', 16);
            $t->string('created_at', 24);
            $t->string('committed_at', 24)->nullable();
        });
        foreach (['expense_document_relocation_items', 'expense_document_storage_history'] as $table) {
            Schema::create($table, function (Blueprint $t) use ($table) {
                $t->uuid('operation_id');
                $t->uuid('document_id');
                $t->primary(['operation_id', 'document_id']);
                $t->foreign('operation_id')->references('operation_id')->on('expense_document_relocations')->restrictOnDelete();
                $t->foreign('document_id')->references('id')->on('expense_documents')->restrictOnDelete();
                $t->text('old_version');
                $t->text('new_version');
                $t->text('document_snapshot');
                $t->string('source_fingerprint', 64);
                $t->string('target_fingerprint', 64);
                $t->string('prepared_at', 24);
                if ($table === 'expense_document_storage_history') { $t->string('committed_at', 24); }
            });
        }
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared("CREATE FUNCTION finance_document_relocation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DOCUMENT_STORAGE_HISTORY_IMMUTABLE'; END; $$");
            DB::unprepared('CREATE TRIGGER document_relocation_items_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON expense_document_relocation_items FOR EACH STATEMENT EXECUTE FUNCTION finance_document_relocation_immutable()');
            DB::unprepared('CREATE TRIGGER document_storage_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON expense_document_storage_history FOR EACH STATEMENT EXECUTE FUNCTION finance_document_relocation_immutable()');
        } elseif (DB::getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER document_relocation_items_no_update BEFORE UPDATE ON expense_document_relocation_items BEGIN SELECT RAISE(ABORT, 'DOCUMENT_STORAGE_HISTORY_IMMUTABLE'); END");
            DB::unprepared("CREATE TRIGGER document_relocation_items_no_delete BEFORE DELETE ON expense_document_relocation_items BEGIN SELECT RAISE(ABORT, 'DOCUMENT_STORAGE_HISTORY_IMMUTABLE'); END");
            DB::unprepared("CREATE TRIGGER document_storage_history_no_update BEFORE UPDATE ON expense_document_storage_history BEGIN SELECT RAISE(ABORT, 'DOCUMENT_STORAGE_HISTORY_IMMUTABLE'); END");
            DB::unprepared("CREATE TRIGGER document_storage_history_no_delete BEFORE DELETE ON expense_document_storage_history BEGIN SELECT RAISE(ABORT, 'DOCUMENT_STORAGE_HISTORY_IMMUTABLE'); END");
        } else { throw new RuntimeException('RELOCATION_DATABASE_UNSUPPORTED'); }
    }

    public function down(): void
    {
        Schema::dropIfExists('expense_document_storage_history');
        Schema::dropIfExists('expense_document_relocation_items');
        Schema::dropIfExists('expense_document_relocations');
        if (DB::getDriverName() === 'pgsql') { DB::unprepared('DROP FUNCTION IF EXISTS finance_document_relocation_immutable()'); }
    }
};
