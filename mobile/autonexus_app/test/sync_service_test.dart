import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
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
    store = await OfflineStore.open(path: '${temp.path}/offline.db', photoDirectory: Directory('${temp.path}/evidence'));
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

  test('a successful push marks the advance applied and sends one operation', () async {
    final requests = <String>[];
    final client = MockClient((request) async {
      requests.add('${request.method} ${request.url.path}');
      if (request.url.path == '/sync/overlays') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect((body['operations'] as List).single['operationId'], 'op-1');
        expect((body['operations'] as List).single['payload']['expectedVersion'], 3);
        return http.Response(jsonEncode({'overlay': {'overlayId': body['overlayId']}, 'replayed': false, 'replayedOperations': []}), 201);
      }
      return http.Response(jsonEncode({'applied': ['op-1'], 'pending': [], 'failed': []}), 200);
    });

    final outcome = await SyncService(baseUrl: 'http://sync', store: store, client: client).pushPending(subject: 'user-a', token: 'token');

    expect(outcome.applied, ['op-1']);
    expect(requests, ['POST /sync/overlays', 'POST /sync/overlays/${requests.last.split('/')[3]}/push']);
    expect((await store.queue('user-a')).single.state, QueueState.applied);
    expect(await store.pendingCount('user-a'), 0);
  });

  test('a lost response keeps the advance pending with the same operationId', () async {
    var pushAttempts = 0;
    final client = MockClient((request) async {
      if (request.url.path == '/sync/overlays') return http.Response(jsonEncode({'overlay': {}, 'replayed': false}), 201);
      pushAttempts++;
      if (pushAttempts == 1) throw const SocketException('response lost');
      return http.Response(jsonEncode({'applied': ['op-1'], 'pending': [], 'failed': []}), 200);
    });

    final service = SyncService(baseUrl: 'http://sync', store: store, client: client);
    final first = await service.pushPending(subject: 'user-a', token: 'token');
    expect(first.error, 'SERVICE_UNAVAILABLE');
    expect((await store.queue('user-a')).single.state, QueueState.pending);
    expect((await store.queue('user-a')).single.attempts, 1);

    final second = await service.pushPending(subject: 'user-a', token: 'token');
    expect(second.applied, ['op-1']);
    expect((await store.queue('user-a')).single.operationId, 'op-1');
    expect((await store.queue('user-a')).single.state, QueueState.applied);
  });

  test('a version conflict is terminal and keeps its code', () async {
    final client = MockClient((request) async {
      if (request.url.path == '/sync/overlays') return http.Response(jsonEncode({'overlay': {}, 'replayed': false}), 201);
      return http.Response(jsonEncode({'applied': [], 'pending': [], 'failed': [{'operationId': 'op-1', 'state': 'conflict', 'code': 'VERSION_CONFLICT'}]}), 200);
    });

    await SyncService(baseUrl: 'http://sync', store: store, client: client).pushPending(subject: 'user-a', token: 'token');
    final row = (await store.queue('user-a')).single;
    expect(row.state, QueueState.conflict);
    expect(row.lastCode, 'VERSION_CONFLICT');
    expect(await store.pendingCount('user-a'), 0);
  });

  test('a rejection by the owner is visible and not retried', () async {
    final client = MockClient((request) async {
      if (request.url.path == '/sync/overlays') return http.Response(jsonEncode({'overlay': {}, 'replayed': false}), 201);
      return http.Response(jsonEncode({'applied': [], 'pending': [], 'failed': [{'operationId': 'op-1', 'state': 'rejected', 'code': 'EXECUTION_ACCESS_DENIED'}]}), 200);
    });

    await SyncService(baseUrl: 'http://sync', store: store, client: client).pushPending(subject: 'user-a', token: 'token');
    final row = (await store.queue('user-a')).single;
    expect(row.state, QueueState.rejected);
    expect(row.lastCode, 'EXECUTION_ACCESS_DENIED');
  });

  test('an expired upload asks for re-authorisation instead of duplicating the advance', () async {
    final client = MockClient((request) async {
      if (request.url.path == '/sync/overlays') return http.Response(jsonEncode({'overlay': {}, 'replayed': false}), 201);
      return http.Response(jsonEncode({'applied': [], 'pending': [], 'failed': [{'operationId': 'op-1', 'state': 'needs-reupload', 'code': 'EVIDENCE_OBJECT_MISSING'}]}), 200);
    });

    await SyncService(baseUrl: 'http://sync', store: store, client: client).pushPending(subject: 'user-a', token: 'token');
    final row = (await store.queue('user-a')).single;
    expect(row.state, QueueState.needsReupload);
    expect(row.operationId, 'op-1');
    expect(await store.pendingCount('user-a'), 1);
  });

  test('a 401 keeps the queue untouched so the session can be renewed', () async {
    final client = MockClient((request) async => http.Response('{"code":"UNAUTHENTICATED"}', 401));
    final outcome = await SyncService(baseUrl: 'http://sync', store: store, client: client).pushPending(subject: 'user-a', token: 'expired');
    expect(outcome.error, 'SERVICE_UNAVAILABLE');
    expect((await store.queue('user-a')).single.state, QueueState.pending);
  });
}
