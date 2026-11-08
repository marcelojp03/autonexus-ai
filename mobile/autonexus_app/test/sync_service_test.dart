import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'package:autonexus_mobile/api/owner_api.dart';
import 'package:autonexus_mobile/offline/offline_models.dart';
import 'package:autonexus_mobile/offline/offline_store.dart';
import 'package:autonexus_mobile/offline/sync_service.dart';

/// Behaviour of the client side of the synchronisation, against a scripted MS05 transport.
///
/// It proves what the client controls: one operationId per advance on every retry, a lost response
/// leaving the queue intact, and conflicts/rejections surfaced with their code instead of being
/// retried forever. The real coordinator is covered by scripts/sync/verify-sync-real.mjs.
void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory temp;
  late OfflineStore store;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('autonexus-sync');
    store = await OfflineStore.open(
      path: '${temp.path}/offline.db',
      photoDirectory: Directory('${temp.path}/evidence'),
    );
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
      ),
    );
  });

  tearDown(() async {
    await store.close();
    if (await temp.exists()) await temp.delete(recursive: true);
  });

  test(
    'a successful push marks the advance applied and sends one operation',
    () async {
      final requests = <String>[];
      final client = MockClient((request) async {
        requests.add('${request.method} ${request.url.path}');
        if (request.url.path == '/sync/overlays') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          expect((body['operations'] as List).single['operationId'], 'op-1');
          expect(
            (body['operations'] as List).single['payload']['expectedVersion'],
            3,
          );
          return http.Response(
            jsonEncode({
              'overlay': {'overlayId': body['overlayId']},
              'replayed': false,
              'replayedOperations': [],
            }),
            201,
          );
        }
        return http.Response(
          jsonEncode({
            'applied': ['op-1'],
            'pending': [],
            'failed': [],
          }),
          200,
        );
      });

      final outcome = await SyncService(
        baseUrl: 'http://sync',
        store: store,
        client: client,
      ).pushPending(subject: 'user-a', token: 'token');

      expect(outcome.applied, ['op-1']);
      expect(requests, [
        'POST /sync/overlays',
        'POST /sync/overlays/${requests.last.split('/')[3]}/push',
      ]);
      expect((await store.queue('user-a')).single.state, QueueState.applied);
      expect(await store.pendingCount('user-a'), 0);
    },
  );

  test(
    'a lost response keeps the advance pending with the same operationId',
    () async {
      var pushAttempts = 0;
      final client = MockClient((request) async {
        if (request.url.path == '/sync/overlays') {
          return http.Response(
            jsonEncode({'overlay': {}, 'replayed': false}),
            201,
          );
        }
        pushAttempts++;
        if (pushAttempts == 1) throw const SocketException('response lost');
        return http.Response(
          jsonEncode({
            'applied': ['op-1'],
            'pending': [],
            'failed': [],
          }),
          200,
        );
      });

      final service = SyncService(
        baseUrl: 'http://sync',
        store: store,
        client: client,
      );
      final first = await service.pushPending(
        subject: 'user-a',
        token: 'token',
      );
      expect(first.error, 'SERVICE_UNAVAILABLE');
      expect((await store.queue('user-a')).single.state, QueueState.pending);
      expect((await store.queue('user-a')).single.attempts, 1);

      final second = await service.pushPending(
        subject: 'user-a',
        token: 'token',
      );
      expect(second.applied, ['op-1']);
      expect((await store.queue('user-a')).single.operationId, 'op-1');
      expect((await store.queue('user-a')).single.state, QueueState.applied);
    },
  );

  for (final sameOverlayReplay in [true, false]) {
    test(
      'recovers photo advance after response loss and reopen (same-overlay replay: $sameOverlayReplay)',
      () async {
        await store.updateState('op-1', QueueState.applied);
        const operationId = '55555555-5555-4555-8555-555555555555';
        const advanceId = '77777777-7777-4777-8777-777777777777';
        final bytes = utf8.encode('accepted-advance-photo');
        final photo = await store.savePhoto(operationId, bytes, 'jpg');
        final imageHash = sha256.convert(bytes).toString();
        await store.enqueue(
          QueuedAdvance(
            operationId: operationId,
            subject: 'user-a',
            assignmentId: 'assignment-1',
            baseVersion: 3,
            description: 'Avance con foto conservada',
            minutesWorked: 10,
            createdAt: DateTime.utc(2026, 11, 4, 12),
            state: QueueState.pending,
            photoPath: photo.path,
            photoSha256: imageHash,
          ),
        );
        final advanceEnvelopes = <String>[];
        var reopened = false;
        var ownerWrites = 0;
        var advancePushes = 0;
        var storedReads = 0;
        var evidenceRequests = 0;
        final client = MockClient((request) async {
          if (request.url.path == '/sync/overlays') {
            final envelope = jsonDecode(request.body) as Map<String, dynamic>;
            final operation = (envelope['operations'] as List).single as Map;
            if (operation['entity'] == 'evidence-authorize') {
              evidenceRequests++;
              expect(operation['target']['advanceId'], advanceId);
              expect(operation['file']['sha256'], imageHash);
              return http.Response(
                jsonEncode({'code': 'EVIDENCE_STORAGE_UNAVAILABLE'}),
                503,
              );
            }
            expect(operation['entity'], 'advance');
            expect(operation['operationId'], operationId);
            advanceEnvelopes.add(request.body);
            return http.Response(
              jsonEncode({
                'overlay': {'overlayId': envelope['overlayId']},
                'replayed': reopened && sameOverlayReplay,
                'replayedOperations': [],
              }),
              201,
            );
          }
          if (request.url.path.endsWith('/push')) {
            advancePushes++;
            if (!reopened) {
              ownerWrites++;
              throw const SocketException('accepted response lost');
            }
            return http.Response(
              jsonEncode({
                'applied': [operationId],
                'pending': [],
                'failed': [],
                'results': [],
              }),
              200,
            );
          }
          expect(request.method, 'GET');
          expect(request.url.path, '/sync/operations/$operationId');
          if (!reopened) throw const SocketException('app interrupted');
          storedReads++;
          return http.Response(
            jsonEncode({
              'operation': {
                'operationId': operationId,
                'state': 'applied',
                'lastResult': {'status': 201, 'code': 'HTTP_201'},
                'lastBody': {
                  'advance': {'id': advanceId},
                  'execution': {'version': 4},
                },
              },
            }),
            200,
          );
        });
        final first = await SyncService(
          baseUrl: 'http://sync',
          store: store,
          client: client,
        ).pushPending(subject: 'user-a', token: 'token');
        expect(first.pending, [operationId]);
        expect(evidenceRequests, 0);
        final saved = await store.syncRequest(operationId);
        await store.close();
        store = await OfflineStore.open(
          path: '${temp.path}/offline.db',
          photoDirectory: Directory('${temp.path}/evidence'),
        );
        reopened = true;
        final second = await SyncService(
          baseUrl: 'http://sync',
          store: store,
          client: client,
        ).pushPending(subject: 'user-a', token: 'renewed-token');
        expect(second.error, 'EVIDENCE_STORAGE_UNAVAILABLE');
        expect(second.pending, [operationId]);
        expect(storedReads, 1);
        expect(evidenceRequests, 1);
        expect(ownerWrites, 1);
        expect(advancePushes, sameOverlayReplay ? 1 : 2);
        expect(advanceEnvelopes, [advanceEnvelopes.first, advanceEnvelopes.first]);
        expect(await store.syncRequest(operationId), saved);
        final row = (await store.queue('user-a'))
            .singleWhere((item) => item.operationId == operationId);
        expect(row.ownerAdvanceId, advanceId);
        expect(row.operationId, operationId);
        expect(row.baseVersion, 3);
        expect(row.state, QueueState.pending);
        expect(row.photoPath, photo.path);
        expect(row.photoSha256, imageHash);
        expect(await File(row.photoPath!).readAsBytes(), bytes);
      },
    );
  }

  test('a version conflict is terminal and keeps its code', () async {
    final client = MockClient((request) async {
      if (request.url.path == '/sync/overlays') {
        return http.Response(
          jsonEncode({'overlay': {}, 'replayed': false}),
          201,
        );
      }
      return http.Response(
        jsonEncode({
          'applied': [],
          'pending': [],
          'failed': [
            {
              'operationId': 'op-1',
              'state': 'conflict',
              'code': 'VERSION_CONFLICT',
            },
          ],
        }),
        200,
      );
    });

    await SyncService(
      baseUrl: 'http://sync',
      store: store,
      client: client,
    ).pushPending(subject: 'user-a', token: 'token');
    final row = (await store.queue('user-a')).single;
    expect(row.state, QueueState.conflict);
    expect(row.lastCode, 'VERSION_CONFLICT');
    expect(await store.pendingCount('user-a'), 0);
  });

  test('a rejection by the owner is visible and not retried', () async {
    final client = MockClient((request) async {
      if (request.url.path == '/sync/overlays') {
        return http.Response(
          jsonEncode({'overlay': {}, 'replayed': false}),
          201,
        );
      }
      return http.Response(
        jsonEncode({
          'applied': [],
          'pending': [],
          'failed': [
            {
              'operationId': 'op-1',
              'state': 'rejected',
              'code': 'EXECUTION_ACCESS_DENIED',
            },
          ],
        }),
        200,
      );
    });

    await SyncService(
      baseUrl: 'http://sync',
      store: store,
      client: client,
    ).pushPending(subject: 'user-a', token: 'token');
    final row = (await store.queue('user-a')).single;
    expect(row.state, QueueState.rejected);
    expect(row.lastCode, 'EXECUTION_ACCESS_DENIED');
  });

  test('an expired upload asks for re-authorisation instead of duplicating the advance', () async {
    final client = MockClient((request) async {
      if (request.url.path == '/sync/overlays') {
        return http.Response(
          jsonEncode({'overlay': {}, 'replayed': false}),
          201,
        );
      }
      return http.Response(
        jsonEncode({
          'applied': [],
          'pending': [],
          'failed': [
            {
              'operationId': 'op-1',
              'state': 'needs-reupload',
              'code': 'EVIDENCE_OBJECT_MISSING',
            },
          ],
        }),
        200,
      );
    });

    await SyncService(
      baseUrl: 'http://sync',
      store: store,
      client: client,
    ).pushPending(subject: 'user-a', token: 'token');
    final row = (await store.queue('user-a')).single;
    expect(row.state, QueueState.needsReupload);
    expect(row.operationId, 'op-1');
    expect(await store.pendingCount('user-a'), 1);
  });

  test(
    'a 401 keeps the queue untouched so the session can be renewed',
    () async {
      final client = MockClient(
        (request) async => http.Response('{"code":"UNAUTHENTICATED"}', 401),
      );
      final outcome = await SyncService(
        baseUrl: 'http://sync',
        store: store,
        client: client,
      ).pushPending(subject: 'user-a', token: 'expired');
      expect(outcome.error, 'UNAUTHENTICATED');
      expect((await store.queue('user-a')).single.state, QueueState.pending);
    },
  );

  for (final manual in [false, true]) {
  test('a photographed advance syncs with optional real inference (manual: $manual)', () async {
    await store.updateState('op-1', QueueState.applied);
    const operationId = '11111111-1111-4111-8111-111111111111';
    const assignmentId = '22222222-2222-4222-8222-222222222222';
    const advanceId = '33333333-3333-4333-8333-333333333333';
    const evidenceId = '44444444-4444-4444-8444-444444444444';
    final review = manual ? InspectionReview(mode: 'manual', reason: 'model_unavailable',
      interpretation: 'Revisión de carrocería', reviewedAt: DateTime.utc(2026)) : null;
    final bytes = utf8.encode('fixture-image-bytes');
    final photo = await store.savePhoto(operationId, bytes, 'jpg');
    await store.enqueue(
      QueuedAdvance(
        operationId: operationId,
        subject: 'user-a',
        assignmentId: assignmentId,
        baseVersion: 3,
        description: review?.ownerDescription ?? 'Revisión de carrocería',
        inspectionReview: review,
        minutesWorked: 15,
        createdAt: DateTime.utc(2026, 11, 4, 12),
        state: QueueState.pending,
        photoPath: photo.path,
        photoSha256: sha256.convert(bytes).toString(),
        runId: manual ? null : 'run-1',
        modelVersion: manual ? null : 'mobile-v1',
        labels: manual ? const {} : const {'dent': 0.8},
        humanReviewLabels: manual ? null : const [],
        humanReviewedAt: manual ? null : DateTime.utc(2026, 11, 4, 12, 1),
      ),
    );

    final entities = <String>[];
    final postedOperations = <Map<String, dynamic>>[];
    final byOverlay = <String, Map<String, dynamic>>{};
    final syncClient = MockClient((request) async {
      if (request.url.path == '/sync/overlays') {
        final envelope = jsonDecode(request.body) as Map<String, dynamic>;
        final operation = Map<String, dynamic>.from(
          (envelope['operations'] as List).single as Map,
        );
        byOverlay[envelope['overlayId'] as String] = operation;
        postedOperations.add(operation);
        return http.Response(
          jsonEncode({
            'overlay': {},
            'replayed': false,
            'replayedOperations': [],
          }),
          201,
        );
      }
      if (request.url.path.endsWith('/push')) {
        final overlayId = request.url.path.split('/')[3];
        final operation = byOverlay[overlayId]!;
        final id = operation['operationId'] as String;
        final entity = operation['entity'] as String;
        entities.add(entity);
        final body = switch (entity) {
          'advance' => {
            'execution': {'version': 4},
            'advance': {'id': advanceId},
            'replayed': false,
          },
          'evidence-authorize' => {
            'evidence': {'id': evidenceId, 'attempt': 1, 'state': 'pending'},
            'upload': {
              'url': 'https://private-upload.invalid/signed',
              'method': 'PUT',
              'headersJson': jsonEncode({'Content-Type': 'image/jpeg'}),
              'expiresAt': '2026-11-04T13:00:00Z',
            },
          },
          'evidence-confirm' => {
            'evidence': {'id': evidenceId, 'state': 'available'},
            'replayed': false,
          },
          'client-inference' => {
            'analysisId': 'analysis-1',
            'verifiedByServer': false,
          },
          _ => throw StateError('unexpected entity'),
        };
        return http.Response(
          jsonEncode({
            'applied': [id],
            'pending': [],
            'failed': [],
            'results': [
              {
                'operationId': id,
                'status': 201,
                'code': 'HTTP_201',
                'body': body,
              },
            ],
          }),
          200,
        );
      }
      throw StateError('unexpected MS05 request');
    });
    String? uploadAuthorization;
    final uploadClient = MockClient((request) async {
      uploadAuthorization = request.headers['authorization'];
      expect(request.method, 'PUT');
      expect(request.bodyBytes, bytes);
      return http.Response('', 200);
    });
    final service = SyncService(
      baseUrl: 'http://sync',
      store: store,
      client: syncClient,
      uploadClient: uploadClient,
      readEvidence: (token, assignment, id) async =>
          EvidenceSnapshot(id: id, version: 1, state: 'pending'),
    );

    final outcome = await service.pushPending(
      subject: 'user-a',
      token: 'actor-token',
    );

    expect(entities, [
      'advance',
      'evidence-authorize',
      'evidence-confirm',
      if (!manual) 'client-inference',
    ]);
    expect(uploadAuthorization, isNull);
    expect(postedOperations[2]['payload']['expectedVersion'], 1);
    expect(postedOperations[2]['baseVersion'], 1);
    expect(postedOperations[1]['file'], {
      'sha256': sha256.convert(bytes).toString(),
      'bytes': bytes.length,
      'contentType': 'image/jpeg',
    });
    if (!manual) { expect(
      (postedOperations.last['clientInference']
          as Map<String, dynamic>)['humanReview'],
      {'modelVersion': 'mobile-v1', 'labels': <String>[]},
    ); }
    expect(outcome.applied, [operationId]);
    final row = (await store.queue('user-a'))
        .singleWhere((item) => item.operationId == operationId);
    expect(row.state, QueueState.applied);
    expect(row.ownerAdvanceId, advanceId);
    expect(row.evidenceId, evidenceId);
    expect(row.evidenceState, 'available');
    expect(row.inferenceState, manual ? isNull : 'applied');
    if (manual) expect(postedOperations.every((op) => op['clientInference'] == null), isTrue);
    service.dispose();
  });

  }

  test(
    'lost upload response confirms once after restart without another PUT',
    () async {
      await store.updateState('op-1', QueueState.applied);
      const operationId = '11111111-1111-4111-8111-111111111111';
      const assignmentId = '22222222-2222-4222-8222-222222222222';
      const advanceId = '33333333-3333-4333-8333-333333333333';
      const evidenceId = '44444444-4444-4444-8444-444444444444';
      final bytes = utf8.encode('fixture-image-bytes');
      final photo = await store.savePhoto(operationId, bytes, 'jpg');
      await store.enqueue(
        QueuedAdvance(
          operationId: operationId,
          subject: 'user-a',
          assignmentId: assignmentId,
          baseVersion: 3,
          description: 'Revisión de carrocería',
          minutesWorked: 15,
          createdAt: DateTime.utc(2026, 11, 4, 12),
          state: QueueState.pending,
          photoPath: photo.path,
          photoSha256: sha256.convert(bytes).toString(),
          runId: 'run-1',
          modelVersion: 'mobile-v1',
          labels: const {'dent': 0.8},
          humanReviewLabels: const [],
          humanReviewedAt: DateTime.utc(2026, 11, 4, 12, 1),
        ),
      );

      final entities = <String>[];
      final postedOperations = <Map<String, dynamic>>[];
      final byOverlay = <String, Map<String, dynamic>>{};
      final syncClient = MockClient((request) async {
        if (request.url.path == '/sync/overlays') {
          final envelope = jsonDecode(request.body) as Map<String, dynamic>;
          final operation = Map<String, dynamic>.from(
            (envelope['operations'] as List).single as Map,
          );
          byOverlay[envelope['overlayId'] as String] = operation;
          postedOperations.add(operation);
          return http.Response(
            jsonEncode({
              'overlay': {},
              'replayed': false,
              'replayedOperations': [],
            }),
            201,
          );
        }
        if (request.url.path.endsWith('/push')) {
          final overlayId = request.url.path.split('/')[3];
          final operation = byOverlay[overlayId]!;
          final id = operation['operationId'] as String;
          final entity = operation['entity'] as String;
          entities.add(entity);
          final body = switch (entity) {
            'advance' => {
              'execution': {'version': 4},
              'advance': {'id': advanceId},
              'replayed': false,
            },
            'evidence-authorize' => {
              'evidence': {'id': evidenceId, 'attempt': 1, 'state': 'pending'},
              'upload': {
                'url': 'https://private-upload.invalid/signed',
                'method': 'PUT',
                'headersJson': jsonEncode({'Content-Type': 'image/jpeg'}),
                'expiresAt': '2026-11-04T13:00:00Z',
              },
            },
            'evidence-confirm' => {
              'evidence': {'id': evidenceId, 'state': 'available'},
              'replayed': false,
            },
            'client-inference' => {
              'analysisId': 'analysis-1',
              'verifiedByServer': false,
            },
            _ => throw StateError('unexpected entity'),
          };
          return http.Response(
            jsonEncode({
              'applied': [id],
              'pending': [],
              'failed': [],
              'results': [
                {
                  'operationId': id,
                  'status': 201,
                  'code': 'HTTP_201',
                  'body': body,
                },
              ],
            }),
            200,
          );
        }
        throw StateError('unexpected MS05 request');
      });
      String? uploadAuthorization;
      var putCount = 0;
      final uploadClient = MockClient((request) async {
        uploadAuthorization = request.headers['authorization'];
        expect(request.method, 'PUT');
        expect(request.bodyBytes, bytes);
        putCount++;
        throw const SocketException('PUT response lost');
      });
      final service = SyncService(
        baseUrl: 'http://sync',
        store: store,
        client: syncClient,
        uploadClient: uploadClient,
        readEvidence: (token, assignment, id) async =>
            EvidenceSnapshot(id: id, version: 1, state: 'pending'),
      );

      final interrupted = await service.pushPending(
        subject: 'user-a',
        token: 'actor-token',
      );

      expect(interrupted.pending, [operationId]);
      await store.close();
      store = await OfflineStore.open(
        path: '${temp.path}/offline.db',
        photoDirectory: Directory('${temp.path}/evidence'),
      );
      final outcome = await SyncService(
        baseUrl: 'http://sync',
        store: store,
        client: syncClient,
        uploadClient: uploadClient,
        readEvidence: (token, assignment, id) async =>
            EvidenceSnapshot(id: id, version: 1, state: 'pending'),
      ).pushPending(subject: 'user-a', token: 'actor-token');
      expect(putCount, 1);
      expect(entities, [
        'advance',
        'evidence-authorize',
        'evidence-confirm',
        'client-inference',
      ]);
      expect(uploadAuthorization, isNull);
      expect(postedOperations[2]['payload']['expectedVersion'], 1);
      expect(postedOperations[2]['baseVersion'], 1);
      expect(postedOperations[1]['file'], {
        'sha256': sha256.convert(bytes).toString(),
        'bytes': bytes.length,
        'contentType': 'image/jpeg',
      });
      expect(
        (postedOperations.last['clientInference']
            as Map<String, dynamic>)['humanReview'],
        {'modelVersion': 'mobile-v1', 'labels': <String>[]},
      );
      expect(outcome.applied, [operationId]);
      final row = (await store.queue('user-a'))
          .singleWhere((item) => item.operationId == operationId);
      expect(row.state, QueueState.applied);
      expect(row.ownerAdvanceId, advanceId);
      expect(row.evidenceId, evidenceId);
      expect(row.evidenceState, 'available');
      expect(row.inferenceState, 'applied');
      service.dispose();
    },
  );

  test('re-authorizes the same evidence after a rejected signed PUT without duplicating the advance', () async {
    await store.updateState('op-1', QueueState.applied);
    const operationId = '55555555-5555-4555-8555-555555555555';
    const assignmentId = '66666666-6666-4666-8666-666666666666';
    const advanceId = '77777777-7777-4777-8777-777777777777';
    const evidenceId = '88888888-8888-4888-8888-888888888888';
    final bytes = utf8.encode('retry-photo-bytes');
    final photo = await store.savePhoto(operationId, bytes, 'jpg');
    await store.enqueue(
      QueuedAdvance(
        operationId: operationId,
        subject: 'user-a',
        assignmentId: assignmentId,
        baseVersion: 3,
        description: 'Evidencia pendiente',
        minutesWorked: 10,
        createdAt: DateTime.utc(2026, 11, 4, 12),
        state: QueueState.pending,
        photoPath: photo.path,
        photoSha256: sha256.convert(bytes).toString(),
      ),
    );
    final entities = <String>[];
    final posted = <Map<String, dynamic>>[];
    final byOverlay = <String, Map<String, dynamic>>{};
    final syncClient = MockClient((request) async {
      if (request.url.path == '/sync/overlays') {
        final envelope = jsonDecode(request.body) as Map<String, dynamic>;
        final operation = Map<String, dynamic>.from(
          (envelope['operations'] as List).single as Map,
        );
        byOverlay[envelope['overlayId'] as String] = operation;
        posted.add(operation);
        return http.Response(
          jsonEncode({'overlay': {}, 'replayedOperations': []}),
          201,
        );
      }
      if (request.url.path.endsWith('/push')) {
        final operation = byOverlay[request.url.path.split('/')[3]]!;
        final id = operation['operationId'] as String;
        final entity = operation['entity'] as String;
        entities.add(entity);
        final attempt = entity == 'evidence-reauthorize' ? 2 : 1;
        final body = switch (entity) {
          'advance' => {
            'execution': {'version': 4},
            'advance': {'id': advanceId},
          },
          'evidence-authorize' || 'evidence-reauthorize' => {
            'evidence': {
              'id': evidenceId,
              'attempt': attempt,
              'state': 'pending',
            },
            'upload': {
              'url': 'https://private-upload.invalid/signed-$attempt',
              'method': 'PUT',
              'headers': {'Content-Type': 'image/jpeg'},
              'expiresAt': '2026-11-04T13:00:00Z',
            },
          },
          'evidence-confirm' => {
            'evidence': {'id': evidenceId, 'state': 'available'},
          },
          'client-inference' => {
            'analysisId': 'analysis-retry',
            'verifiedByServer': false,
          },
          _ => throw StateError('unexpected entity'),
        };
        return http.Response(
          jsonEncode({
            'applied': [id],
            'pending': [],
            'failed': [],
            'results': [
              {
                'operationId': id,
                'status': 201,
                'code': 'HTTP_201',
                'body': body,
              },
            ],
          }),
          200,
        );
      }
      throw StateError('unexpected MS05 request');
    });
    var putCount = 0;
    final uploadClient = MockClient((request) async {
      putCount++;
      expect(request.headers['authorization'], isNull);
      return http.Response('', putCount == 1 ? 403 : 200);
    });
    final service = SyncService(
      baseUrl: 'http://sync',
      store: store,
      client: syncClient,
      uploadClient: uploadClient,
      readEvidence: (token, assignment, id) async =>
          EvidenceSnapshot(id: id, version: 8 + putCount, state: 'pending'),
    );

    final first = await service.pushPending(
      subject: 'user-a',
      token: 'actor-token',
    );
    expect(first.failed.single.state, 'needs-reupload');
    expect(
      (await store.queue('user-a'))
          .singleWhere((item) => item.operationId == operationId)
          .evidenceId,
      evidenceId,
    );
    final second = await service.pushPending(
      subject: 'user-a',
      token: 'actor-token',
    );

    expect(second.applied, [operationId]);
    expect(entities.where((entity) => entity == 'advance').length, 1);
    expect(entities, [
      'advance',
      'evidence-authorize',
      'evidence-reauthorize',
      'evidence-confirm',
    ]);
    expect(
      (posted[2]['payload'] as Map<String, dynamic>)['expectedVersion'],
      9,
    );
    expect(
      (await store.queue('user-a'))
          .singleWhere((item) => item.operationId == operationId)
          .evidenceAttempt,
      2,
    );
    expect(putCount, 2);
    service.dispose();
  });

  test('empty push responses conserve every pending row and envelope across restart', () async {
    final sent = <String>[];
    final client = MockClient((request) async {
      if (request.url.path == '/sync/overlays') {
        sent.add(request.body);
        return http.Response('{}', 201);
      }
      return http.Response('{}', 200);
    });
    final first = await SyncService(
      baseUrl: 'http://sync',
      store: store,
      client: client,
    ).pushPending(subject: 'user-a', token: 'token');
    expect(first.applied, isEmpty);
    expect(first.pending, ['op-1']);
    expect((await store.queue('user-a')).single.state, QueueState.pending);
    await store.close();
    store = await OfflineStore.open(
      path: '${temp.path}/offline.db',
      photoDirectory: Directory('${temp.path}/evidence'),
    );
    final second = await SyncService(
      baseUrl: 'http://sync',
      store: store,
      client: client,
    ).pushPending(subject: 'user-a', token: 'renewed');
    expect(second.pending, ['op-1']);
    expect(sent.length, 2);
    expect(sent[1], sent[0]);
    expect(sent[0], isNot(contains('renewed')));
  });

  for (final state in [
    'pending',
    'sending',
    'needs-reupload',
    'conflict',
    'rejected',
  ]) {
    test(
      'replay resumes original overlay or conserves terminal $state',
      () async {
        final pushes = <String>[];
        final client = MockClient((request) async {
          if (request.url.path == '/sync/overlays') {
            return http.Response(
              jsonEncode({
                'replayedOperations': ['op-1'],
              }),
              201,
            );
          }
          if (request.method == 'GET') {
            return http.Response(
              jsonEncode({
                'operation': {
                  'operationId': 'op-1',
                  'overlayId': 'original-overlay',
                  'state': state,
                  'lastResult': {'status': 409, 'code': 'RETAINED_CODE'},
                },
              }),
              200,
            );
          }
          pushes.add(request.url.path);
          return http.Response(
            jsonEncode({
              'applied': ['op-1'],
            }),
            200,
          );
        });
        final outcome = await SyncService(
          baseUrl: 'http://sync',
          store: store,
          client: client,
        ).pushPending(subject: 'user-a', token: 'token');
        final row = (await store.queue('user-a')).single;
        if (state == 'conflict' || state == 'rejected') {
          expect(pushes, isEmpty);
          expect(outcome.failed.single.code, 'RETAINED_CODE');
          expect(row.state.wire, state);
          expect(row.description, 'Cambio de aceite');
          expect(row.baseVersion, 3);
          expect(row.lastStatus, 409);
        } else {
          expect(pushes, ['/sync/overlays/original-overlay/push']);
          expect(outcome.applied, ['op-1']);
        }
      },
    );
  }

  for (final retry in [false, true]) {
    test(
      '${retry ? "retry" : "confirm"} preserves evidence request version after restart',
      () async {
        await store.updateState('op-1', QueueState.applied);
        final bytes = utf8.encode('durable-photo');
        final photo = await store.savePhoto('photo-op', bytes, 'jpg');
        await store.enqueue(
          QueuedAdvance(
            operationId: 'photo-op',
            subject: 'user-a',
            assignmentId: 'assignment-1',
            baseVersion: 40,
            description: 'Foto',
            minutesWorked: 2,
            createdAt: DateTime.utc(2026, 11, 4),
            state: QueueState.pending,
            photoPath: photo.path,
            photoSha256: sha256.convert(bytes).toString(),
            ownerAdvanceId: 'advance-1',
            evidenceId: 'evidence-1',
            evidenceAttempt: 1,
            evidenceState: retry ? 'failed' : 'uploaded',
          ),
        );
        var versionReads = 0;
        var firstRun = true;
        final sent = <String>[];
        final operations = <String, Map<String, dynamic>>{};
        final client = MockClient((request) async {
          if (request.url.path == '/sync/overlays') {
            final envelope = jsonDecode(request.body) as Map<String, dynamic>;
            final operation = Map<String, dynamic>.from(
              (envelope['operations'] as List).single as Map,
            );
            final entity = operation['entity'];
            if (entity ==
                (retry ? 'evidence-reauthorize' : 'evidence-confirm')) {
              sent.add(request.body);
              expect(operation['baseVersion'], 2);
              expect(operation['payload']['expectedVersion'], 2);
              if (firstRun) throw const SocketException('create response lost');
            }
            operations[envelope['overlayId'] as String] = operation;
            return http.Response('{}', 201);
          }
          final operation = operations[request.url.path.split('/')[3]]!;
          final id = operation['operationId'];
          final body = operation['entity'] == 'evidence-reauthorize'
              ? {
                  'evidence': {
                    'id': 'evidence-1',
                    'attempt': 2,
                    'state': 'pending',
                  },
                  'upload': {
                    'url': 'https://private-upload.invalid/signed',
                    'headers': {'Content-Type': 'image/jpeg'},
                  },
                }
              : {
                  'evidence': {'id': 'evidence-1', 'state': 'available'},
                };
          return http.Response(
            jsonEncode({
              'applied': [id],
              'results': [
                {'operationId': id, 'status': 200, 'body': body},
              ],
            }),
            200,
          );
        });
        Future<EvidenceSnapshot> reader(
          String token,
          String assignment,
          String evidenceId,
        ) async {
          versionReads++;
          return EvidenceSnapshot(
            id: evidenceId,
            version: firstRun ? 2 : 3,
            state: retry ? 'failed' : 'pending',
          );
        }

        final first = await SyncService(
          baseUrl: 'http://sync',
          store: store,
          client: client,
          readEvidence: reader,
        ).pushPending(subject: 'user-a', token: 'token');
        expect(first.pending, ['photo-op']);
        await store.close();
        store = await OfflineStore.open(
          path: '${temp.path}/offline.db',
          photoDirectory: Directory('${temp.path}/evidence'),
        );
        firstRun = false;
        final second = await SyncService(
          baseUrl: 'http://sync',
          store: store,
          client: client,
          readEvidence: reader,
          uploadClient: MockClient((request) async => http.Response('', 200)),
        ).pushPending(subject: 'user-a', token: 'new-token');
        expect(second.applied, ['photo-op']);
        expect(sent.length, 2);
        expect(sent[1], sent[0]);
        expect(versionReads, retry ? 2 : 1);
        final saved = await store.syncRequest(
          (jsonDecode(sent[0])['operations'] as List).single['operationId']
              as String,
        );
        expect(jsonEncode(saved), isNot(contains('private-upload')));
        expect(jsonEncode(saved), isNot(contains('new-token')));
        expect(await File(photo.path).exists(), isTrue);
      },
    );
  }
  test(
    'schema 5 upgrade preserves pending data and creates durable requests',
    () async {
      await store.close();
      final database = await openDatabase('${temp.path}/offline.db');
      await database.execute('DROP TABLE sync_requests');
      await database.execute('ALTER TABLE queue DROP COLUMN inspection_review_json');
      await database.setVersion(5);
      await database.close();
      store = await OfflineStore.open(
        path: '${temp.path}/offline.db',
        photoDirectory: Directory('${temp.path}/evidence'),
      );
      expect(
        (await store.queue('user-a')).single.description,
        'Cambio de aceite',
      );
      await store.saveSyncRequest('op-1', 'op-1', {'operations': []});
      expect(await store.syncRequest('op-1'), {'operations': []});
    },
  );
}
