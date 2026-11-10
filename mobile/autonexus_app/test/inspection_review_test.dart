import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:autonexus_mobile/offline/offline_models.dart';
import 'package:autonexus_mobile/offline/offline_store.dart';
import 'package:autonexus_mobile/offline/sync_service.dart';
import 'package:autonexus_mobile/app/journey_controller.dart';
import 'package:autonexus_mobile/app/work_page.dart';
import 'package:autonexus_mobile/evidence/photo_capture.dart';
import 'package:autonexus_mobile/inference/damage_classifier.dart';
import 'package:autonexus_mobile/session/keycloak_session.dart';
import 'package:autonexus_mobile/api/owner_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });
  late Directory temp;
  late OfflineStore store;
  late Database db;
  late JourneyController controller;
  final work = PreparedWork(
    subject: 'operator',
    assignmentId: 'assignment',
    orderId: 'order',
    orderNumber: 'WO-1',
    version: 1,
    preparedAt: DateTime.utc(2026),
    expiresAt: DateTime.utc(2030),
  );
  setUp(() async {
    temp = await Directory.systemTemp.createTemp('cu22-review-');
    final path = '${temp.path}/bounded.db';
    store = await OfflineStore.open(
      path: path,
      photoDirectory: Directory('${temp.path}/photos'),
    );
    db = await openDatabase(path);
    await store.setLocalSubject(work.subject);
    await store.saveWork(work);
    controller = JourneyController(
      session: KeycloakSession(
        issuer: '',
        clientId: '',
        redirectUrl: '',
        store: store,
        launchBrowser: (_) async => false,
      ),
      store: store,
      api: OwnerApi(baseUrl: ''),
      sync: SyncService(baseUrl: '', store: store),
    );
    await controller.load();
  });
  tearDown(() async {
    controller.dispose();
    await store.close();
    await temp.delete(recursive: true);
  });

  test(
    'manual inspection reopens without fabricated prediction; copy preserves review',
    () async {
      final review = InspectionReview(
        mode: 'manual',
        reason: 'model_unavailable',
        interpretation: 'Observación humana independiente',
        labels: ['dent'],
        reviewedAt: DateTime.utc(2026),
      );
      final saved = await controller.queueAdvance(
        work: work,
        description: review.interpretation,
        minutes: 5,
        inspectionReview: review,
      );
      expect(saved, isNotNull);
      await store.close();
      store = await OfflineStore.open(
        path: '${temp.path}/bounded.db',
        photoDirectory: Directory('${temp.path}/photos'),
      );
      final item = (await store.queue(work.subject)).single;
      expect(item.inspectionReview!.toJson(), review.toJson());
      expect(
        item.copyWith(state: QueueState.sending).inspectionReview!.toJson(),
        review.toJson(),
      );
      expect(item.runId, isNull);
      expect(item.modelVersion, isNull);
      expect(item.labels, isEmpty);
      expect(item.subject, work.subject);
      expect(item.ownerPayload()['description'], contains('manual'));
      expect(item.description, contains('model_unavailable'));
      expect(item.description.length, lessThanOrEqualTo(2000));
    },
  );

  test(
    'schema 6 migration preserves prediction, prior human correction and pending PKCE',
    () async {
      await controller.queueAdvance(
        work: work,
        description: 'Predicción anterior',
        minutes: 5,
        runId: 'old-run',
        modelVersion: 'old-version',
        labels: {'dent': 0.31},
        humanReviewLabels: ['scratch'],
        humanReviewedAt: DateTime.utc(2026),
      );
      await db.insert('auth_state', {
        'state': 'pending',
        'code_verifier': 'verifier',
        'nonce': 'nonce',
        'redirect_url': 'test',
        'created_at': DateTime.utc(2026).toIso8601String(),
      });
      await db.execute('ALTER TABLE queue DROP COLUMN inspection_review_json');
      await db.setVersion(6);
      await store.close();
      store = await OfflineStore.open(
        path: '${temp.path}/bounded.db',
        photoDirectory: Directory('${temp.path}/photos'),
      );
      final item = (await store.queue(work.subject)).single;
      expect(item.inspectionReview, isNull);
      expect(item.runId, 'old-run');
      expect(item.modelVersion, 'old-version');
      expect(item.labels, {'dent': 0.31});
      expect(item.humanReviewLabels, ['scratch']);
      expect(
        (await store.pendingAuthorization('pending'))!.codeVerifier,
        'verifier',
      );
    },
  );

  testWidgets('advance text draft survives leaving and reopening the work', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => WorkPage(controller: controller, work: work),
                ),
              ),
              child: const Text('Open work'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open work'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('advance-description')),
      'Draft description',
    );
    await tester.enterText(find.byKey(const Key('advance-minutes')), '23');
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open work'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('advance-description')))
          .controller!
          .text,
      'Draft description',
    );
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('advance-minutes')))
          .controller!
          .text,
      '23',
    );
    await tester.pumpWidget(const SizedBox.shrink());
  });

  test(
    'controlled SQLITE_FULL returns null, keeps staging and retry creates exactly one',
    () async {
      final staged = await store.saveStagedPhoto(
        subject: work.subject,
        assignmentId: work.assignmentId,
        bytes: [1, 2, 3],
        sha256: 'hash',
      );
      await db.execute(
        "CREATE TRIGGER fail_queue BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT, 'SQLITE_FULL controlled'); END",
      );
      final failed = await controller.queueAdvance(
        work: work,
        description: 'Observación',
        minutes: 5,
        photo: staged,
      );
      expect(failed, isNull);
      expect(controller.lastError, contains('SQLITE_FULL'));
      expect(await File(staged.path).readAsBytes(), [1, 2, 3]);
      expect(
        (await store.stagedPhoto(work.subject, work.assignmentId))!.path,
        staged.path,
      );
      expect(await store.queue(work.subject), isEmpty);
      await db.execute('DROP TRIGGER fail_queue');
      final saved = await controller.queueAdvance(
        work: work,
        description: 'Observación',
        minutes: 5,
        photo: staged,
      );
      expect(saved, isNotNull);
      expect(await store.queue(work.subject), hasLength(1));
      expect(await store.stagedPhoto(work.subject, work.assignmentId), isNull);
      await store.removeStagedPhoto(work.subject, work.assignmentId);
      expect(await File(saved!.photoPath!).exists(), isTrue);
      await expectLater(
        store.enqueue(saved),
        throwsA(isA<DatabaseException>()),
      );
      expect(await store.queue(work.subject), hasLength(1));
    },
  );

  test('failed staging handoff rolls queue insert back before retry', () async {
    final staged = await store.saveStagedPhoto(
      subject: work.subject,
      assignmentId: work.assignmentId,
      bytes: [1, 2, 3],
      sha256: 'hash',
    );
    await db.execute(
      "CREATE TRIGGER fail_handoff BEFORE DELETE ON staged_photos BEGIN SELECT RAISE(ABORT, 'SQLITE_FULL controlled'); END",
    );
    expect(
      await controller.queueAdvance(
        work: work,
        description: 'Inspección',
        minutes: 5,
        photo: staged,
      ),
      isNull,
    );
    expect(await store.queue(work.subject), isEmpty);
    expect(
      (await store.stagedPhoto(work.subject, work.assignmentId))!.path,
      staged.path,
    );
    expect(await File(staged.path).exists(), isTrue);
    await db.execute('DROP TRIGGER fail_handoff');
    expect(
      await controller.queueAdvance(
        work: work,
        description: 'Inspección',
        minutes: 5,
        photo: staged,
      ),
      isNotNull,
    );
    expect(await store.queue(work.subject), hasLength(1));
  });

  test(
    'real bounded SQLite page quota rejects a large insert without replacing old queue',
    () async {
      await controller.queueAdvance(
        work: work,
        description: 'Avance anterior',
        minutes: 5,
      );
      final pages =
          (await db.rawQuery('PRAGMA page_count')).single.values.single as int;
      await db.rawQuery('PRAGMA max_page_count = $pages');
      final large = QueuedAdvance(
        operationId: 'large',
        subject: work.subject,
        assignmentId: work.assignmentId,
        baseVersion: 1,
        description: List.filled(65536, 'x').join(),
        minutesWorked: 1,
        createdAt: DateTime.now(),
        state: QueueState.pending,
      );
      await expectLater(
        store.enqueue(large),
        throwsA(isA<DatabaseException>()),
      );
      expect(
        (await store.queue(work.subject)).single.description,
        'Avance anterior',
      );
    },
  );

  test('controlled ENOSPC partial write preserves previous staging', () async {
    final previous = await store.saveStagedPhoto(
      subject: work.subject,
      assignmentId: work.assignmentId,
      bytes: [4, 5, 6],
      sha256: 'old',
    );
    await store.close();
    store = await OfflineStore.open(
      path: '${temp.path}/bounded.db',
      photoDirectory: Directory('${temp.path}/photos'),
      writePhoto: (file, bytes) async {
        await file.writeAsBytes([9]);
        throw const FileSystemException(
          'ENOSPC controlled',
          '',
          OSError('No space left', 28),
        );
      },
    );
    await expectLater(
      store.saveStagedPhoto(
        subject: work.subject,
        assignmentId: work.assignmentId,
        bytes: [7, 8],
        sha256: 'new',
      ),
      throwsA(isA<FileSystemException>()),
    );
    expect(
      (await store.stagedPhoto(work.subject, work.assignmentId))!.path,
      previous.path,
    );
    expect(await File(previous.path).readAsBytes(), [4, 5, 6]);
    expect(await store.photoDirectory.list().length, 1);
  });

  testWidgets(
    'manual review stays available with no photo/model and retains form on failure',
    (tester) async {
      tester.view.physicalSize = const Size(1000, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      await tester.runAsync(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: WorkPage(controller: controller, work: work),
          ),
        );
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byKey(const Key('inspection-review')));
        await tester.tap(find.byKey(const Key('inspection-review')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('advance-description')),
          'Revisión manual propia',
        );
        await tester.enterText(find.byKey(const Key('advance-minutes')), '15');
        await db.execute(
          "CREATE TRIGGER fail_queue BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT, 'SQLITE_FULL controlled'); END",
        );
        await tester.scrollUntilVisible(
          find.byKey(const Key('save-advance')),
          180,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.tap(find.byKey(const Key('save-advance')));
        await _finishSave(tester);
        expect(find.textContaining('No se pudo guardar'), findsOneWidget);
        expect(find.text('Revisión manual propia'), findsOneWidget);
        await db.execute('DROP TRIGGER fail_queue');
        await tester.tap(find.byKey(const Key('save-advance')));
        await _finishSave(tester);
        expect(
          (await store.queue(
            work.subject,
          )).single.inspectionReview!.interpretation,
          'Revisión manual propia',
        );
        await tester.pumpWidget(const SizedBox.shrink());
      });
    },
  );

  testWidgets('rejected input offers manual review on a phone-sized screen', (
    tester,
  ) async {
    controller.dispose();
    controller = JourneyController(
      session: KeycloakSession(
        issuer: '',
        clientId: '',
        redirectUrl: '',
        store: store,
        launchBrowser: (_) async => false,
      ),
      store: store,
      api: OwnerApi(baseUrl: ''),
      sync: SyncService(baseUrl: '', store: store),
      photoCapture: _InvalidCapture(),
    );
    await tester.runAsync(() async {
      await controller.load();
    });
    tester.view.physicalSize = const Size(412, 915);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    await tester.runAsync(() async {
      await tester.pumpWidget(
        MaterialApp(
          home: WorkPage(controller: controller, work: work),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('choose-photo')));
      await tester.tap(find.byKey(const Key('choose-photo')));
      for (var i = 0; i < 100; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
        if (find
            .textContaining('No se pudo preparar la foto:')
            .evaluate()
            .isNotEmpty) {
          break;
        }
      }
      expect(
        find.textContaining('No se pudo preparar la foto:'),
        findsOneWidget,
      );
      await tester.enterText(
        find.byKey(const Key('advance-description')),
        'Revisión deliberada',
      );
      await tester.enterText(find.byKey(const Key('advance-minutes')), '15');
      await tester.ensureVisible(find.byKey(const Key('inspection-review')));
      await tester.drag(find.byType(ListView), const Offset(0, -150));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inspection-review')));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byKey(const Key('save-advance')),
        180,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const Key('save-advance')));
      await _finishSave(tester);
      final saved = (await store.queue(work.subject)).single;
      expect(saved.inspectionReview!.reason, 'input_rejected');
      expect(saved.photoPath, isNull);
      expect(saved.runId, isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  });

  for (final replacement in [
    'valid',
    'review-again',
    'invalid',
    'staging',
    'first',
  ]) {
    testWidgets('photo replacement $replacement keeps review tied to its image', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1000, 2200);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      await tester.runAsync(() async {
        final bytesA = Uint8List.fromList(
          img.encodeJpg(img.Image(width: 32, height: 32)),
        );
        final bytesB = Uint8List.fromList(
          img.encodeJpg(img.Image(width: 64, height: 64)),
        );
        StagedPhoto? previous;
        if (replacement != 'first') {
          previous = await store.saveStagedPhoto(
            subject: work.subject,
            assignmentId: work.assignmentId,
            bytes: bytesA,
            sha256: 'photo-a',
          );
        }
        controller.dispose();
        controller = JourneyController(
          session: KeycloakSession(
            issuer: '',
            clientId: '',
            redirectUrl: '',
            store: store,
            launchBrowser: (_) async => false,
          ),
          store: store,
          api: OwnerApi(baseUrl: ''),
          sync: SyncService(baseUrl: '', store: store),
          photoCapture: _ReplacementCapture(
            replacement == 'invalid' ? Uint8List(16) : bytesB,
          ),
        );
        await controller.load();
        await tester.pumpWidget(
          MaterialApp(
            home: WorkPage(
              controller: controller,
              work: work,
              loadClassifier: () async => _Classifier(fail: false),
            ),
          ),
        );
        await Future<void>.delayed(const Duration(milliseconds: 150));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byKey(const Key('inspection-review')));
        await tester.tap(find.byKey(const Key('inspection-review')));
        await tester.pumpAndSettle();
        if (replacement != 'first') {
          await tester.tap(find.text('Usar registro manual'));
          await tester.pumpAndSettle();
        }
        await tester.tap(find.widgetWithText(FilterChip, 'Abolladura'));
        await tester.enterText(
          find.byKey(const Key('advance-description')),
          'Interpretación propia A',
        );
        await tester.enterText(find.byKey(const Key('advance-minutes')), '27');
        if (replacement == 'staging') {
          await db.execute(
            "CREATE TRIGGER fail_replacement BEFORE INSERT ON staged_photos BEGIN SELECT RAISE(ABORT, 'SQLITE_FULL controlled'); END",
          );
        }
        await tester.ensureVisible(find.byKey(const Key('choose-photo')));
        await tester.tap(find.byKey(const Key('choose-photo')));
        for (var i = 0; i < 150; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
          if (tester
                  .widget<OutlinedButton>(find.byKey(const Key('choose-photo')))
                  .onPressed !=
              null) {
            break;
          }
        }
        await tester.pumpAndSettle();
        final rejected = ['invalid', 'staging'].contains(replacement);
        await tester.ensureVisible(find.byKey(const Key('inspection-review')));
        expect(
          tester
              .widget<SwitchListTile>(
                find.byKey(const Key('inspection-review')),
              )
              .value,
          rejected,
        );
        if (rejected) {
          expect(
            (await store.stagedPhoto(work.subject, work.assignmentId))!.path,
            previous!.path,
          );
          expect(await File(previous.path).readAsBytes(), bytesA);
          expect(await store.photoDirectory.list().length, 1);
          expect(
            tester
                .widget<FilterChip>(
                  find.widgetWithText(FilterChip, 'Abolladura'),
                )
                .selected,
            isTrue,
          );
        } else {
          expect(
            (await store.stagedPhoto(work.subject, work.assignmentId))!.path,
            isNot(previous?.path),
          );
          if (replacement == 'review-again') {
            await tester.tap(find.byKey(const Key('inspection-review')));
            await tester.pumpAndSettle();
            expect(
              tester
                  .widgetList<FilterChip>(find.byType(FilterChip))
                  .every((chip) => !chip.selected),
              isTrue,
            );
            expect(
              tester
                  .widget<SwitchListTile>(
                    find.widgetWithText(SwitchListTile, 'Usar registro manual'),
                  )
                  .value,
              isTrue,
            );
          }
        }
        expect(find.text('Interpretación propia A'), findsOneWidget);
        expect(find.text('27'), findsOneWidget);
        await tester.scrollUntilVisible(
          find.byKey(const Key('save-advance')),
          180,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.tap(find.byKey(const Key('save-advance')));
        await _finishSave(tester);
        final saved = (await store.queue(work.subject)).single;
        expect(saved.minutesWorked, 27);
        expect(saved.labels.values, everyElement(0.6));
        if (rejected) {
          expect(saved.photoPath, previous!.path);
          expect(saved.inspectionReview!.mode, 'assisted');
          expect(saved.inspectionReview!.reason, 'below_thresholds');
          expect(saved.inspectionReview!.labels, ['dent']);
          expect(saved.humanReviewLabels, ['dent']);
        } else if (replacement == 'review-again') {
          expect(saved.inspectionReview!.labels, isEmpty);
          expect(saved.inspectionReview!.mode, 'manual');
        } else {
          expect(saved.inspectionReview, isNull);
          expect(saved.humanReviewLabels, isNull);
          expect(saved.humanReviewedAt, isNull);
        }
        await tester.pumpWidget(const SizedBox.shrink());
      });
    });
  }

  for (final scenario in [
    'missing',
    'inference',
    'resource',
    'low',
    'assisted',
  ]) {
    testWidgets('$scenario keeps photo and independent manual review', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1000, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      await tester.runAsync(() async {
        final bytes = Uint8List.fromList(
          img.encodeJpg(img.Image(width: 32, height: 32)),
        );
        final staged = await store.saveStagedPhoto(
          subject: work.subject,
          assignmentId: work.assignmentId,
          bytes: bytes,
          sha256: 'hash',
        );
        await tester.pumpWidget(
          MaterialApp(
            home: WorkPage(
              controller: controller,
              work: work,
              loadClassifier: () async {
                if (scenario == 'missing') throw StateError('model absent');
                if (scenario == 'resource') throw OutOfMemoryError();
                return _Classifier(fail: scenario == 'inference');
              },
            ),
          ),
        );
        await Future<void>.delayed(const Duration(milliseconds: 120));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byKey(const Key('inspection-review')));
        expect(find.byKey(const Key('inspection-review')), findsOneWidget);
        if (scenario == 'low') {
          expect(find.textContaining('No concluyente:'), findsOneWidget);
        }
        await tester.tap(find.byKey(const Key('inspection-review')));
        await tester.pumpAndSettle();
        expect(
          tester
              .widgetList<FilterChip>(find.byType(FilterChip))
              .every((chip) => !chip.selected),
          isTrue,
        );
        if (scenario == 'assisted') {
          await tester.tap(find.text('Usar registro manual'));
          await tester.pumpAndSettle();
          await tester.tap(find.widgetWithText(FilterChip, 'Abolladura'));
          await tester.pumpAndSettle();
        }
        await tester.enterText(
          find.byKey(const Key('advance-description')),
          'Revisión deliberada',
        );
        await tester.enterText(find.byKey(const Key('advance-minutes')), '15');
        await tester.scrollUntilVisible(
          find.byKey(const Key('save-advance')),
          180,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.tap(find.byKey(const Key('save-advance')));
        await _finishSave(tester);
        final saved = (await store.queue(work.subject)).single;
        expect(
          saved.inspectionReview!.mode,
          scenario == 'assisted' ? 'assisted' : 'manual',
        );
        if (scenario == 'assisted') expect(saved.humanReviewLabels, ['dent']);
        expect(
          saved.inspectionReview!.reason,
          scenario == 'missing'
              ? 'model_unavailable'
              : scenario == 'inference'
              ? 'inference_failed'
              : scenario == 'resource'
              ? 'insufficient_resources'
              : 'below_thresholds',
        );
        expect(
          saved.labels.length,
          ['low', 'assisted'].contains(scenario) ? 4 : 0,
        );
        expect(await File(staged.path).exists(), isTrue);
        await tester.pumpWidget(const SizedBox.shrink());
      });
    });
  }
}

class _Classifier implements InspectionClassifier {
  _Classifier({required this.fail});
  final bool fail;
  @override
  ManifestData get manifest => const ManifestData(
    labels: ['crack', 'dent', 'glass_shatter', 'scratch'],
    thresholds: [0.91, 0.82, 0.73, 0.64],
    modelVersion: 'real-test-version',
    runId: 'test-run',
    qualityStatus: 'experimental',
    qualityNote: 'test',
  );
  @override
  Future<DeviceResult> analyse(Uint8List bytes) async {
    if (fail) throw StateError('controlled inference fault');
    return DeviceResult(
      scores: [
        for (var i = 0; i < 4; i++)
          DeviceScore(
            label: manifest.labels[i],
            score: 0.6,
            threshold: manifest.thresholds[i],
            flagged: 0.6 >= manifest.thresholds[i],
          ),
      ],
      latencyMs: 1,
    );
  }

  @override
  void dispose() {}
}

Future<void> _finishSave(WidgetTester tester) async {
  for (var attempt = 0; attempt < 150; attempt++) {
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await tester.pump();
    if (find.textContaining('No se pudo guardar:').evaluate().isNotEmpty ||
        find
            .text(
              'Guardado en este dispositivo como pendiente. Todavía no está en el servidor.',
            )
            .evaluate()
            .isNotEmpty) {
      return;
    }
  }
  fail('Local save did not finish within the bounded wait.');
}

class _InvalidCapture implements PhotoCapturePort {
  @override
  Future<Uint8List?> pick(PhotoSource source) async => Uint8List(16);
  @override
  Future<Uint8List?> retrieveLostPhoto() async => null;
}

class _ReplacementCapture implements PhotoCapturePort {
  _ReplacementCapture(this.bytes);
  final Uint8List bytes;
  @override
  Future<Uint8List?> pick(PhotoSource source) async => bytes;
  @override
  Future<Uint8List?> retrieveLostPhoto() async => null;
}
