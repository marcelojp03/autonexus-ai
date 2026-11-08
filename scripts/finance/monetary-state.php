<?php
// Operator-only read oracle. No HTTP route, credentials, records or document bytes are emitted.
require '/app/services/finance/vendor/autoload.php';
$app = require '/app/services/finance/bootstrap/app.php';
$app->make(implode(chr(92), ['Illuminate', 'Contracts', 'Console', 'Kernel']))->bootstrap();
$db = $app->make('db')->connection();
if (($argv[1] ?? '') === 'transactions') {
    $rows = $db->select('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE usename=current_user AND client_addr=inet_client_addr() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL');
    echo json_encode(['activeTransactions' => $rows[0]->count], JSON_THROW_ON_ERROR);
    exit;
}
$snapshot = [];
foreach (['obligations', 'payments', 'receipts', 'verifications', 'expenses', 'categories', 'operations', 'audit'] as $table) {
    $rows = $db->table('financial_'.$table)->orderBy('id')->get(['id', 'record']);
    $hash = hash_init('sha256');
    foreach ($rows as $row) { hash_update($hash, $row->id.chr(0).$row->record.chr(10)); }
    $snapshot[$table] = ['count' => $rows->count(), 'sha256' => hash_final($hash)];
}
echo json_encode($snapshot, JSON_THROW_ON_ERROR);
