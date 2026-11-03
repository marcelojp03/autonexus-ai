import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:path_provider/path_provider.dart';

import 'package:autonexus_mobile/offline/offline_models.dart';
import 'package:autonexus_mobile/offline/offline_store.dart';
import 'package:autonexus_mobile/offline/sync_service.dart';

/// Real textual journey on the device: prepare → close → reopen without network → save the advance →
/// reconnect → apply exactly once.
///
/// The session token comes from the harness through `--dart-define` (the in-app PKCE login is the
/// next increment). Everything else is the client's own code: SQLite, the queue and the MS05 client.
///
/// Run:
///   flutter test integration_test/offline_journey_test.dart -d <device> \
///     --dart-define=CU_TOKEN=... --dart-define=CU_SYNC_URL=http://10.0.2.2:3005 \
///     --dart-define=CU_ORIGIN=http://10.0.2.2:4285 --dart-define=CU_ASSIGNMENT=<uuid>
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  if (Platform.isWindows || Platform.isLinux || Platform.isMacOS) {
    // Desktop run (used when no Android device is attached): same client code, FFI database.
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  }

  const token = String.fromEnvironment('CU_TOKEN');
  const syncUrl = String.fromEnvironment('CU_SYNC_URL');
  const origin = String.fromEnvironment('CU_ORIGIN');
  const assignmentId = String.fromEnvironment('CU_ASSIGNMENT');

  testWidgets('preparar, cerrar, reabrir sin red, guardar y sincronizar una sola vez', (tester) async {
    expect(token.isNotEmpty && syncUrl.isNotEmpty && origin.isNotEmpty && assignmentId.isNotEmpty, isTrue,
        reason: 'the harness must pass CU_TOKEN, CU_SYNC_URL, CU_ORIGIN and CU_ASSIGNMENT');

    final documents = await getApplicationDocumentsDirectory();
    final databasePath = '${documents.path}/offline-journey.db';
    final photoDirectory = Directory('${documents.path}/evidence-journey');

    // 1) Online: prepare the work (real owner through the BFF) and keep it locally.
    final version = await _executionVersion(origin, assignmentId, token);
    var store = await OfflineStore.open(path: databasePath, photoDirectory: photoDirectory);
    await store.saveWork(PreparedWork(
      subject: 'journey-subject',
      assignmentId: assignmentId,
      orderId: 'order',
      orderNumber: 'WO-JOURNEY',
      version: version,
      preparedAt: DateTime.now().toUtc(),
      expiresAt: DateTime.now().toUtc().add(const Duration(days: 7)),
    ));
    await store.close();

    // 2) Close and reopen: a new store instance reads the prepared work from disk (this is the
    //    "app closed" case; no network is used here).
    store = await OfflineStore.open(path: databasePath, photoDirectory: photoDirectory);
    final prepared = await store.work('journey-subject', assignmentId);
    expect(prepared, isNotNull);
    expect(prepared!.version, version);
    expect(prepared.isUsableAt(DateTime.now().toUtc()), isTrue);

    // 3) Offline: save the pending advance with a private photograph.
    final operationId = _uuid();
    final photo = await store.savePhoto(operationId, List<int>.filled(2048, 3), 'jpg');
    await store.enqueue(QueuedAdvance(
      operationId: operationId,
      subject: 'journey-subject',
      assignmentId: assignmentId,
      baseVersion: version,
      description: 'Avance guardado sin conexión',
      minutesWorked: 15,
      createdAt: DateTime.now().toUtc(),
      state: QueueState.pending,
      photoPath: photo.path,
    ));
    expect(await store.pendingCount('journey-subject'), 1);

    // 4) Reconnect and push: the owner must end with exactly one new advance, even after a second
    //    push of the same queue.
    final service = SyncService(baseUrl: syncUrl, store: store);
    final first = await service.pushPending(subject: 'journey-subject', token: token);
    expect(first.applied, contains(operationId));

    final advancesAfterFirst = await _advanceCount(origin, assignmentId, token);
    final second = await service.pushPending(subject: 'journey-subject', token: token);
    expect(second.applied, isEmpty, reason: 'an applied advance must not be sent again');
    final advancesAfterSecond = await _advanceCount(origin, assignmentId, token);
    expect(advancesAfterSecond, advancesAfterFirst, reason: 'no duplicate advance');

    final queue = await store.queue('journey-subject');
    expect(queue.single.state, QueueState.applied);
    service.dispose();
    await store.close();
  });
}

Future<int> _executionVersion(String origin, String assignmentId, String token) async {
  final response = await _graphql(origin, token, 'query(!){myExecution(assignmentId:){version}}', {'id': assignmentId});
  expect(response['data'], isNotNull, reason: 'graphql body: ' + _jsonEncode(response));
}

Future<int> _advanceCount(String origin, String assignmentId, String token) async {
  final response = await _graphql(origin, token, 'query(!){myExecution(assignmentId:){advances{id}}}', {'id': assignmentId});
  expect(response['data'], isNotNull, reason: 'graphql body: ' + _jsonEncode(response));
}

Future<Map<String, dynamic>> _graphql(String origin, String token, String query, Map<String, Object?> variables) async {
  final client = HttpClient();
  try {
    final request = await client.postUrl(Uri.parse('$origin/graphql'));
    request.headers
      ..set('Authorization', 'Bearer $token')
      ..contentType = ContentType.json;
    request.write(_jsonEncode({'query': query, 'variables': variables}));
    final response = await request.close();
    final body = await response.transform(const SystemEncoding().decoder).join();
    return _jsonDecode(body) as Map<String, dynamic>;
  } finally {
    client.close(force: true);
  }
}

String _jsonEncode(Object value) => jsonEncode(value);

Object? _jsonDecode(String raw) => jsonDecode(raw);

String _uuid() {
  final now = DateTime.now().microsecondsSinceEpoch;
  final hex = now.toRadixString(16).padLeft(12, '0');
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-4${hex.substring(1, 4)}-8${hex.substring(4, 7)}-${hex.padRight(12, '0').substring(0, 12)}';
}

