import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'package:autonexus_mobile/offline/offline_models.dart';
import 'package:autonexus_mobile/offline/offline_store.dart';

/// Proves the store behaviour that the offline journey depends on: persistence across a reopen,
/// isolation between users, queue states and the private photo directory.
void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory temp;
  late String databasePath;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('autonexus-offline');
    databasePath = '${temp.path}/offline.db';
  });

  tearDown(() async {
    if (await temp.exists()) await temp.delete(recursive: true);
  });

  PreparedWork work(String subject) => PreparedWork(
    subject: subject,
    assignmentId: 'assignment-1',
    orderId: 'order-1',
    orderNumber: 'WO-0001',
    version: 3,
    preparedAt: DateTime.utc(2026, 11, 3, 10),
    expiresAt: DateTime.utc(2026, 11, 10, 10),
  );

  QueuedAdvance advance(String subject, {String operationId = 'op-1'}) =>
      QueuedAdvance(
        operationId: operationId,
        subject: subject,
        assignmentId: 'assignment-1',
        baseVersion: 3,
        description: 'Cambio de aceite',
        minutesWorked: 20,
        createdAt: DateTime.utc(2026, 11, 3, 11),
        state: QueueState.pending,
      );

  test(
    'the prepared work and the queue survive closing and reopening the store',
    () async {
      final first = await OfflineStore.open(
        path: databasePath,
        photoDirectory: Directory('${temp.path}/evidence'),
      );
      await first.saveWork(work('user-a'));
      await first.enqueue(advance('user-a'));
      await first.close();

      final second = await OfflineStore.open(
        path: databasePath,
        photoDirectory: Directory('${temp.path}/evidence'),
      );
      final works = await second.works('user-a');
      final queue = await second.queue('user-a');
      expect(works.single.orderNumber, 'WO-0001');
      expect(queue.single.operationId, 'op-1');
      expect(queue.single.state, QueueState.pending);
      await second.close();
    },
  );

  test(
    'upgrades a version-3 pending queue without losing the saved operation',
    () async {
      final legacy = await openDatabase(
        databasePath,
        version: 3,
        onCreate: (db, version) async {
          await db.execute(
            'CREATE TABLE works(subject TEXT NOT NULL, assignment_id TEXT NOT NULL, order_id TEXT NOT NULL, order_number TEXT NOT NULL, version INTEGER NOT NULL, prepared_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(subject, assignment_id))',
          );
          await db.execute(
            'CREATE TABLE queue(operation_id TEXT NOT NULL PRIMARY KEY, subject TEXT NOT NULL, assignment_id TEXT NOT NULL, base_version INTEGER NOT NULL, description TEXT NOT NULL, minutes_worked INTEGER NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL, photo_path TEXT, photo_sha256 TEXT, run_id TEXT, model_version TEXT, labels_json TEXT, last_code TEXT, last_status INTEGER, attempts INTEGER NOT NULL DEFAULT 0)',
          );
          await db.insert('queue', {
            'operation_id': 'legacy-op',
            'subject': 'user-a',
            'assignment_id': 'assignment-1',
            'base_version': 3,
            'description': 'Avance local previa',
            'minutes_worked': 15,
            'created_at': DateTime.utc(2026, 11, 3, 11).toIso8601String(),
            'state': 'pending',
            'attempts': 2,
          });
        },
      );
      await legacy.close();

      final upgraded = await OfflineStore.open(
        path: databasePath,
        photoDirectory: Directory('${temp.path}/evidence'),
      );
      final migrated = (await upgraded.queue('user-a')).single;
      expect(migrated.operationId, 'legacy-op');
      expect(migrated.description, 'Avance local previa');
      expect(migrated.attempts, 2);
      expect(migrated.humanReviewLabels, isNull);
      expect(migrated.ownerAdvanceId, isNull);
      expect(migrated.evidenceAttempt, 0);
      expect(await upgraded.pendingCount('user-a'), 1);
      await upgraded.close();
    },
  );

  test('one user never sees another user work or queue', () async {
    final store = await OfflineStore.open(
      path: databasePath,
      photoDirectory: Directory('${temp.path}/evidence'),
    );
    await store.saveWork(work('user-a'));
    await store.enqueue(advance('user-a'));
    await store.saveWork(work('user-b'));
    await store.enqueue(advance('user-b', operationId: 'op-2'));

    expect((await store.works('user-a')).length, 1);
    expect((await store.works('user-b')).length, 1);
    expect((await store.queue('user-a')).single.operationId, 'op-1');
    expect(await store.pendingCount('user-b'), 1);
    await store.close();
  });

  test('closing a session forgets that user and keeps the other one', () async {
    final store = await OfflineStore.open(
      path: databasePath,
      photoDirectory: Directory('${temp.path}/evidence'),
    );
    await store.saveWork(work('user-a'));
    await store.enqueue(advance('user-a'));
    final photo = await store.savePhoto('op-1', List<int>.filled(64, 7), 'jpg');
    await store.enqueue(
      QueuedAdvance(
        operationId: 'op-1',
        subject: 'user-a',
        assignmentId: 'assignment-1',
        baseVersion: 3,
        description: 'Cambio de aceite',
        minutesWorked: 20,
        createdAt: DateTime.utc(2026, 11, 3, 11),
        state: QueueState.pending,
        photoPath: photo.path,
      ),
    );

    await store.forget('user-a');
    expect(await store.works('user-a'), isEmpty);
    expect(await store.queue('user-a'), isEmpty);
    expect(await photo.exists(), isFalse);
    await store.close();
  });

  test(
    'terminal states leave the pending count, conflicts stay visible',
    () async {
      final store = await OfflineStore.open(
        path: databasePath,
        photoDirectory: Directory('${temp.path}/evidence'),
      );
      await store.enqueue(advance('user-a', operationId: 'op-ok'));
      await store.enqueue(advance('user-a', operationId: 'op-conflict'));
      expect(await store.pendingCount('user-a'), 2);

      await store.updateState('op-ok', QueueState.applied, clearError: true);
      await store.updateState(
        'op-conflict',
        QueueState.conflict,
        code: 'VERSION_CONFLICT',
      );
      expect(await store.pendingCount('user-a'), 0);

      final queue = await store.queue('user-a');
      final conflict = queue.firstWhere(
        (item) => item.operationId == 'op-conflict',
      );
      expect(conflict.state, QueueState.conflict);
      expect(conflict.lastCode, 'VERSION_CONFLICT');
      await store.close();
    },
  );

  test(
    'the photograph is written to the private directory, not the gallery',
    () async {
      final store = await OfflineStore.open(
        path: databasePath,
        photoDirectory: Directory('${temp.path}/evidence'),
      );
      final file = await store.savePhoto(
        'op-photo',
        List<int>.filled(128, 1),
        'jpg',
      );
      expect(file.path, contains('evidence'));
      expect(await file.length(), 128);
      await store.close();
    },
  );

  test('staged photo and explicit human correction survive store recreation separately from model scores', () async {
    var store = await OfflineStore.open(
      path: databasePath,
      photoDirectory: Directory('${temp.path}/evidence'),
    );
    final staged = await store.saveStagedPhoto(
      subject: 'user-a',
      assignmentId: 'assignment-1',
      bytes: List<int>.filled(128, 9),
      sha256: List.filled(64, 'a').join(),
    );
    await store.beginPhotoCapture('user-a', 'assignment-1');
    final context = await store.pendingPhotoCapture();
    expect(context?.subject, 'user-a');
    expect(context?.assignmentId, 'assignment-1');
    await store.close();

    store = await OfflineStore.open(
      path: databasePath,
      photoDirectory: Directory('${temp.path}/evidence'),
    );
    final restored = await store.stagedPhoto('user-a', 'assignment-1');
    expect(restored?.sha256, staged.sha256);
    expect(await File(restored!.path).exists(), isTrue);
    final photo = await store.promoteStagedPhoto(
      'user-a',
      'assignment-1',
      'op-photo',
    );
    await store.enqueue(
      QueuedAdvance(
        operationId: 'op-photo',
        subject: 'user-a',
        assignmentId: 'assignment-1',
        baseVersion: 3,
        description: 'Inspección manual',
        minutesWorked: 12,
        createdAt: DateTime.utc(2026, 11, 3, 11),
        state: QueueState.pending,
        photoPath: photo!.path,
        photoSha256: staged.sha256,
        labels: const {'dent': 0.81},
        humanReviewLabels: const [],
        humanReviewedAt: DateTime.utc(2026, 11, 3, 11, 1),
        modelVersion: 'model-v1',
      ),
    );
    await store.removeStagedPhoto('user-a', 'assignment-1', deleteFile: false);
    await store.close();

    store = await OfflineStore.open(
      path: databasePath,
      photoDirectory: Directory('${temp.path}/evidence'),
    );
    final queued = (await store.queue('user-a')).single;
    expect(queued.photoSha256, staged.sha256);
    expect(queued.labels['dent'], 0.81);
    expect(queued.humanReviewLabels, isEmpty);
    expect(queued.humanReviewedAt, DateTime.utc(2026, 11, 3, 11, 1));
    expect(queued.modelVersion, 'model-v1');
    expect(await File(queued.photoPath!).exists(), isTrue);
    await store.close();
  });
}
