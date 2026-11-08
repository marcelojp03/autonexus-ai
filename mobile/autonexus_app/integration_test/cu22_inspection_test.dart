import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:integration_test/integration_test.dart';
import 'package:sqflite/sqflite.dart';

import 'package:autonexus_mobile/api/owner_api.dart';
import 'package:autonexus_mobile/app/journey_controller.dart';
import 'package:autonexus_mobile/app/work_page.dart';
import 'package:autonexus_mobile/evidence/photo_capture.dart';
import 'package:autonexus_mobile/inference/damage_classifier.dart';
import 'package:autonexus_mobile/offline/offline_models.dart';
import 'package:autonexus_mobile/offline/offline_store.dart';
import 'package:autonexus_mobile/offline/sync_service.dart';
import 'package:autonexus_mobile/session/keycloak_session.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    // Let the Android first-frame accessibility request settle before the per-test
    // semantics-handle baseline is recorded. Keep Flutter's leak assertions enabled.
    final policy = binding.framePolicy;
    binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
    try {
      runApp(const MaterialApp(home: SizedBox.shrink()));
      await binding.endOfFrame.timeout(const Duration(seconds: 5));
      await Future<void>.delayed(const Duration(milliseconds: 300));
    } finally {
      binding.framePolicy = policy;
    }
    debugPrint(
      'CU22 platform warmup semantics handles: '
      '${binding.debugOutstandingSemanticsHandles}',
    );
  });
  testWidgets(
    'CU22 device replacement: rejected B preserves A then adopted B needs review',
    (tester) async {
      final temp = await Directory.systemTemp.createTemp('cu22-replacement-');
      final path = '${temp.path}/inspection.db';
      final photos = Directory('${temp.path}/photos');
      var store = await OfflineStore.open(path: path, photoDirectory: photos);
      final now = DateTime.now().toUtc();
      final work = PreparedWork(
        subject: 'cu22-synthetic-operator',
        assignmentId: 'cu22-replacement',
        orderId: 'cu22-synthetic-order',
        orderNumber: 'CU22 SYNTHETIC',
        version: 1,
        preparedAt: now,
        expiresAt: now.add(const Duration(days: 1)),
      );
      final api = OwnerApi(baseUrl: '');
      final sync = SyncService(baseUrl: '', store: store);
      final capture = _ReplacementCapture();
      final controller = JourneyController(
        store: store,
        api: api,
        sync: sync,
        session: KeycloakSession(
          issuer: '',
          clientId: '',
          redirectUrl: '',
          store: store,
          launchBrowser: (_) async => false,
        ),
        photoCapture: capture,
      );
      try {
        await store.setLocalSubject(work.subject);
        await store.saveWork(work);
        await controller.load();
        final bytesA = Uint8List.fromList(
          img.encodeJpg(img.Image(width: 32, height: 32)),
        );
        final previous = await store.saveStagedPhoto(
          subject: work.subject,
          assignmentId: work.assignmentId,
          bytes: bytesA,
          sha256: 'synthetic-a',
        );
        await tester.pumpWidget(
          MaterialApp(
            home: WorkPage(
              controller: controller,
              work: work,
              loadClassifier: () async => _ControlledClassifier('low'),
            ),
          ),
        );
        await _reveal(tester, find.textContaining('No concluyente:'));
        await _tap(tester, find.byKey(const Key('inspection-review')));
        await _tap(tester, find.text('Usar registro manual'));
        await _tap(tester, find.widgetWithText(FilterChip, 'Abolladura'));
        await _reveal(tester, find.byKey(const Key('advance-description')));
        await tester.showKeyboard(find.byKey(const Key('advance-description')));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('advance-description')),
          'Interpretación sintética A',
        );
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('advance-description')))
              .controller!
              .text,
          'Interpretación sintética A',
        );
        await _reveal(tester, find.byKey(const Key('advance-minutes')));
        await tester.showKeyboard(find.byKey(const Key('advance-minutes')));
        await tester.pumpAndSettle();
        await tester.enterText(find.byKey(const Key('advance-minutes')), '27');
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        final db = await openDatabase(path);
        for (final reject in ['invalid', 'staging']) {
          capture.bytes = reject == 'invalid'
              ? Uint8List(16)
              : Uint8List.fromList(
                  img.encodeJpg(img.Image(width: 64, height: 64)),
                );
          if (reject == 'staging') {
            await db.execute(
              "CREATE TRIGGER fail_replacement BEFORE INSERT ON staged_photos BEGIN SELECT RAISE(ABORT, 'SQLITE_FULL controlled'); END",
            );
          }
          await _tap(tester, find.byKey(const Key('choose-photo')));
          await _reveal(
            tester,
            find.textContaining('No se pudo preparar la foto:'),
          );
          expect(
            (await store.stagedPhoto(work.subject, work.assignmentId))!.path,
            previous.path,
          );
          expect(await File(previous.path).readAsBytes(), bytesA);
          expect(await photos.list().length, 1);
          await _reveal(tester, find.byKey(const Key('inspection-review')));
          expect(
            tester
                .widget<SwitchListTile>(
                  find.byKey(const Key('inspection-review')),
                )
                .value,
            isTrue,
          );
          await _reveal(
            tester,
            find.byKey(const ValueKey('inspection-reason-below_thresholds')),
          );
          expect(
            tester
                .widget<SwitchListTile>(
                  find.widgetWithText(SwitchListTile, 'Usar registro manual'),
                )
                .value,
            isFalse,
          );
          expect(
            tester
                .widget<FilterChip>(
                  find.widgetWithText(FilterChip, 'Abolladura'),
                )
                .selected,
            isTrue,
          );
          if (reject == 'staging') {
            await db.execute('DROP TRIGGER fail_replacement');
          }
        }
        await _tap(tester, find.byKey(const Key('choose-photo')));
        await _wait(
          tester,
          () =>
              tester
                  .widget<OutlinedButton>(find.byKey(const Key('choose-photo')))
                  .onPressed !=
              null,
        );
        await _reveal(tester, find.byKey(const Key('inspection-review')));
        expect(
          tester
              .widget<SwitchListTile>(
                find.byKey(const Key('inspection-review')),
              )
              .value,
          isFalse,
        );
        final adopted = (await store.stagedPhoto(
          work.subject,
          work.assignmentId,
        ))!;
        expect(adopted.path, isNot(previous.path));
        await _reveal(tester, find.byKey(const Key('advance-description')));
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('advance-description')))
              .controller!
              .text,
          'Interpretación sintética A',
        );
        await _reveal(tester, find.byKey(const Key('advance-minutes')));
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('advance-minutes')))
              .controller!
              .text,
          '27',
        );
        await _tap(tester, find.byKey(const Key('save-advance')));
        await _wait(
          tester,
          () => find
              .textContaining('Guardado en este dispositivo como pendiente.')
              .evaluate()
              .isNotEmpty,
        );
        final saved = (await store.queue(work.subject)).single;
        expect(saved.photoPath, adopted.path);
        expect(saved.inspectionReview, isNull);
        expect(saved.humanReviewLabels, isNull);
        expect(saved.humanReviewedAt, isNull);
        expect(saved.labels.values, everyElement(0.1));
        expect(saved.minutesWorked, 27);
        await tester.pumpWidget(const SizedBox.shrink());
        await store.close();
        store = await OfflineStore.open(path: path, photoDirectory: photos);
        final reopened = (await store.queue(work.subject)).single;
        expect(reopened.operationId, saved.operationId);
        expect(reopened.inspectionReview, isNull);
        expect(reopened.labels, saved.labels);
        expect(await File(reopened.photoPath!).exists(), isTrue);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        controller.dispose();
        api.dispose();
        sync.dispose();
        await store.close();
        await temp.delete(recursive: true);
      }
    },
  );

  for (final scenario in [
    'missing',
    'invalid',
    'inference',
    'resource',
    'low',
  ]) {
    testWidgets('CU22 device $scenario: isolated UI and native SQLite', (
      tester,
    ) async {
      final temp = await Directory.systemTemp.createTemp('cu22-device-');
      final path = '${temp.path}/inspection.db';
      final photos = Directory('${temp.path}/photos');
      var store = await OfflineStore.open(path: path, photoDirectory: photos);
      final now = DateTime.now().toUtc();
      final work = PreparedWork(
        subject: 'cu22-synthetic-operator',
        assignmentId: 'cu22-synthetic-assignment',
        orderId: 'cu22-synthetic-order',
        orderNumber: 'CU22 SYNTHETIC',
        version: 1,
        preparedAt: now,
        expiresAt: now.add(const Duration(days: 1)),
      );
      final api = OwnerApi(baseUrl: '');
      final sync = SyncService(baseUrl: '', store: store);
      final controller = JourneyController(
        store: store,
        api: api,
        sync: sync,
        session: KeycloakSession(
          issuer: '',
          clientId: '',
          redirectUrl: '',
          store: store,
          launchBrowser: (_) async => false,
        ),
        photoCapture: _InvalidCapture(),
      );
      final classifier = _ControlledClassifier(scenario);
      try {
        await store.setLocalSubject(work.subject);
        await store.saveWork(work);
        await controller.load();
        String? stagedPath;
        if (scenario != 'invalid') {
          final bytes = Uint8List.fromList(
            img.encodeJpg(img.Image(width: 32, height: 32)),
          );
          final staged = await store.saveStagedPhoto(
            subject: work.subject,
            assignmentId: work.assignmentId,
            bytes: bytes,
            sha256: 'synthetic-fixture',
          );
          stagedPath = staged.path;
        }
        await tester.pumpWidget(
          MaterialApp(
            home: WorkPage(
              controller: controller,
              work: work,
              loadClassifier: () async {
                if (scenario == 'missing') {
                  return DamageClassifier.load(
                    asset: 'assets/cu22-intentionally-absent.tflite',
                  );
                }
                return classifier;
              },
            ),
          ),
        );
        if (scenario == 'invalid') {
          await _tap(tester, find.byKey(const Key('choose-photo')));
        }
        final message = switch (scenario) {
          'missing' => 'Modelo no disponible o manifiesto inválido.',
          'invalid' => 'No se pudo preparar la foto:',
          'inference' => 'Falló la inferencia.',
          'resource' => 'Recursos insuficientes.',
          _ => 'No concluyente:',
        };
        await _reveal(tester, find.textContaining(message));
        expect(await store.queue(work.subject), isEmpty);
        if (scenario == 'invalid') {
          expect(
            await store.stagedPhoto(work.subject, work.assignmentId),
            isNull,
          );
        } else {
          expect(await File(stagedPath!).exists(), isTrue);
        }
        await _tap(tester, find.byKey(const Key('inspection-review')));
        expect(
          tester
              .widgetList<FilterChip>(find.byType(FilterChip))
              .every((chip) => !chip.selected),
          isTrue,
        );
        final notes = 'Observación humana sintética $scenario';
        await _reveal(tester, find.byKey(const Key('advance-description')));
        await tester.enterText(
          find.byKey(const Key('advance-description')),
          notes,
        );
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        if (scenario == 'missing') {
          final db = await openDatabase(path);
          await db.execute(
            "CREATE TRIGGER cu22_fail BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT, 'SQLITE_FULL controlled'); END",
          );
          await _tap(tester, find.byKey(const Key('save-advance')));
          await _wait(
            tester,
            () => find
                .textContaining('No se pudo guardar:')
                .evaluate()
                .isNotEmpty,
          );
          await _reveal(tester, find.byKey(const Key('advance-description')));
          expect(find.text(notes), findsOneWidget);
          expect(await store.queue(work.subject), isEmpty);
          expect(
            (await store.stagedPhoto(work.subject, work.assignmentId))!.path,
            stagedPath,
          );
          expect(await File(stagedPath!).exists(), isTrue);
          await db.execute('DROP TRIGGER cu22_fail');
        }
        await _tap(tester, find.byKey(const Key('save-advance')));
        await _wait(
          tester,
          () => find
              .textContaining('Guardado en este dispositivo como pendiente.')
              .evaluate()
              .isNotEmpty,
        );
        final saved = (await store.queue(work.subject)).single;
        final expectedReason = switch (scenario) {
          'missing' => 'model_unavailable',
          'invalid' => 'input_rejected',
          'inference' => 'inference_failed',
          'resource' => 'insufficient_resources',
          _ => 'below_thresholds',
        };
        expect(saved.inspectionReview!.mode, 'manual');
        expect(saved.inspectionReview!.reason, expectedReason);
        expect(saved.inspectionReview!.interpretation, notes);
        expect(saved.inspectionReview!.labels, isEmpty);
        expect(saved.state, QueueState.pending);
        expect(saved.subject, work.subject);
        expect(saved.assignmentId, work.assignmentId);
        if (scenario == 'low') {
          expect(saved.runId, 'cu22-injected-run');
          expect(saved.modelVersion, 'cu22-injected-version');
          expect(saved.labels.values, everyElement(0.1));
        } else {
          expect(saved.runId, isNull);
          expect(saved.modelVersion, isNull);
          expect(saved.labels, isEmpty);
        }
        expect(saved.photoPath, scenario == 'invalid' ? isNull : stagedPath);
        await tester.pumpWidget(const SizedBox.shrink());
        if (!['missing', 'invalid'].contains(scenario)) {
          expect(classifier.disposed, isTrue);
        }
        await store.close();
        store = await OfflineStore.open(path: path, photoDirectory: photos);
        final reopened = (await store.queue(work.subject)).single;
        expect(reopened.operationId, saved.operationId);
        expect(
          reopened.inspectionReview!.toJson(),
          saved.inspectionReview!.toJson(),
        );
        expect(reopened.labels, saved.labels);
        expect(reopened.state, QueueState.pending);
        if (reopened.photoPath != null) {
          expect(await File(reopened.photoPath!).exists(), isTrue);
        }
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        controller.dispose();
        api.dispose();
        sync.dispose();
        await store.close();
        await temp.delete(recursive: true);
      }
    });
  }
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await _reveal(tester, finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _reveal(WidgetTester tester, Finder finder) async {
  await tester.pumpAndSettle();
  if (finder.evaluate().isEmpty) {
    tester
        .state<ScrollableState>(find.byType(Scrollable).first)
        .position
        .jumpTo(0);
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      finder,
      140,
      scrollable: find.byType(Scrollable).first,
      maxScrolls: 40,
    );
  }
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
}

Future<void> _wait(WidgetTester tester, bool Function() done) async {
  for (var i = 0; i < 150; i++) {
    await tester.pump(const Duration(milliseconds: 50));
    if (done()) return;
  }
  fail('CU22 bounded wait expired');
}

class _InvalidCapture implements PhotoCapturePort {
  @override
  Future<Uint8List?> pick(PhotoSource source) async => Uint8List(16);
  @override
  Future<Uint8List?> retrieveLostPhoto() async => null;
}

class _ReplacementCapture implements PhotoCapturePort {
  Uint8List bytes = Uint8List(16);
  @override
  Future<Uint8List?> pick(PhotoSource source) async => bytes;
  @override
  Future<Uint8List?> retrieveLostPhoto() async => null;
}

class _ControlledClassifier implements InspectionClassifier {
  _ControlledClassifier(this.scenario);
  final String scenario;
  bool disposed = false;
  @override
  ManifestData get manifest => const ManifestData(
    labels: ['crack', 'dent', 'glass_shatter', 'scratch'],
    thresholds: [0.9, 0.8, 0.7, 0.6],
    runId: 'cu22-injected-run',
    modelVersion: 'cu22-injected-version',
    qualityStatus: 'experimental',
    qualityNote: 'Controlled fixture, not model quality evidence',
  );
  @override
  Future<DeviceResult> analyse(Uint8List bytes) async {
    if (scenario == 'inference') {
      throw StateError('CU22 injected inference failure');
    }
    if (scenario == 'resource') throw OutOfMemoryError();
    return DeviceResult(
      scores: [
        for (var i = 0; i < manifest.labels.length; i++)
          DeviceScore(
            label: manifest.labels[i],
            score: 0.1,
            threshold: manifest.thresholds[i],
            flagged: false,
          ),
      ],
      latencyMs: 0,
    );
  }

  @override
  void dispose() => disposed = true;
}
