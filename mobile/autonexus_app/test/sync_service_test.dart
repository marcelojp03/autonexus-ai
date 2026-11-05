import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

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
        if (request.url.path == '/sync/overlays')
          return http.Response(
            jsonEncode({'overlay': {}, 'replayed': false}),
            201,
          );
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

  test('a version conflict is terminal and keeps its code', () async {
    final client = MockClient((request) async {
      if (request.url.path == '/sync/overlays')
        return http.Response(
          jsonEncode({'overlay': {}, 'replayed': false}),
          201,
        );
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
      if (request.url.path == '/sync/overlays')
        return http.Response(
          jsonEncode({'overlay': {}, 'replayed': false}),
          201,
        );
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
      if (request.url.path == '/sync/overlays')
        return http.Response(
          jsonEncode({'overlay': {}, 'replayed': false}),
          201,
        );
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
      expect(outcome.error, 'SERVICE_UNAVAILABLE');
      expect((await store.queue('user-a')).single.state, QueueState.pending);
    },
  );

  test('a photographed advance authorizes, uploads without bearer, confirms and stores inference separately', () async {
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
      readExecutionVersion: (token, assignment) async => 7,
    );

    final outcome = await service.pushPending(
      subject: 'user-a',
      token: 'actor-token',
    );

    expect(entities, [
      'advance',
      'evidence-authorize',
      'evidence-confirm',
      'client-inference',
    ]);
    expect(uploadAuthorization, isNull);
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
  });

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
              'url':
                  'https://private-upload.invalid/signed-' + attempt.toString(),
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
      readExecutionVersion: (token, assignment) async => 8 + putCount,
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
}
