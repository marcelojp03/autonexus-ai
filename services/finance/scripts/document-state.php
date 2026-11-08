<?php
// Local operator read-only oracle. Never prints storage profiles, grants or document bytes.
require '/app/services/finance/vendor/autoload.php';
$app = require '/app/services/finance/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
try {
    $db=$app->make('db')->connection();
    $db->beginTransaction();
    $db->statement('SET TRANSACTION READ ONLY');
    $db->statement('SET LOCAL statement_timeout=10000');
    $transfer=$db->table('expense_document_relocations')->where('operation_id',$argv[1])->first();
    if (!$transfer || $transfer->state!=='committed') throw new RuntimeException;
    $storage=new App\Infrastructure\Ledger\S3DocumentStorage;
    $items=$db->table('expense_document_relocation_items')->where('operation_id',$argv[1])->orderBy('document_id')->get();
    $documents=[];
    foreach($items as $item) {
        $document=(array)$db->table('expense_documents')->where('id',$item->document_id)->first();
        $document['size_bytes']=(int)$document['size_bytes'];
        $history=$db->table('expense_document_storage_history')->where('operation_id',$argv[1])->where('document_id',$item->document_id)->first();
        $snapshot=$document;$snapshot['object_version']=$item->old_version;
        $unchanged=App\Domain\CanonicalJson::encode($snapshot)===$item->document_snapshot;
        if (!$history || $history->old_version!==$item->old_version || $history->new_version!==$item->new_version || $document['object_version']!==$item->new_version || !$unchanged) throw new RuntimeException;
        $bytes=$storage->get($document['object_key'],$document['object_version']);
        $type=@getimagesizefromstring($bytes);
        if (strlen($bytes)!==$document['size_bytes'] || !hash_equals($document['sha256'],hash('sha256',$bytes)) || ($type['mime']??null)!==$document['content_type']) throw new RuntimeException;
        $documents[]=['id'=>$document['id'],'sha256'=>$document['sha256'],'sizeBytes'=>$document['size_bytes'],'contentType'=>$document['content_type'],
            'oldVersion'=>$item->old_version,'version'=>$document['object_version'],'state'=>$document['state'],'expenseId'=>$document['expense_id'],'metadataUnchanged'=>true,'historyPreserved'=>true];
    }
    $money=[];
    foreach(['obligations','payments','receipts','verifications','expenses','categories','operations','audit'] as $table) {
        $rows=$db->table('financial_'.$table)->orderBy('id')->get(['id','record']);$hash=hash_init('sha256');
        foreach($rows as $row) hash_update($hash,$row->id.chr(0).$row->record.chr(10));
        $money[$table]=['count'=>$rows->count(),'sha256'=>hash_final($hash)];
    }
    $db->rollBack();
    echo json_encode(['pass'=>true,'documents'=>$documents,'money'=>$money],JSON_THROW_ON_ERROR);
}catch(Throwable) { if(isset($db)&&$db->transactionLevel()>0)$db->rollBack();echo json_encode(['pass'=>false,'code'=>'DOCUMENT_STATE_NOT_VERIFIED']);exit(1);}
