/// Synchronisation through MS05.
///
/// The client never talks to the owner services directly and never stores the bearer: the token is
/// passed per call, the overlay carries one `operationId` per advance (so a retry cannot duplicate
/// it) and the answer decides the queue state. Connectivity is only a hint: the request result is
/// what moves an advance out of `pending`.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;

import 'offline_models.dart';
import 'offline_store.dart';

class SyncOutcome {
  const SyncOutcome({required this.applied, required this.pending, required this.failed, this.error});

  final List<String> applied;
  final List<String> pending;
  final List<({String operationId, String state, String? code})> failed;
  final String? error;
}

class SyncService {
  SyncService({required this.baseUrl, required this.store, http.Client? client}) : _client = client ?? http.Client();

  final String baseUrl;
  final OfflineStore store;
  final http.Client _client;

  /// Pushes the pending queue of one user and updates every row with the owner's answer.
  ///
  /// A 401 or a transport failure leaves the rows `pending` (the session is renewed and the same
  /// operationId is retried); a conflict or a rejection is terminal and visible.
  Future<SyncOutcome> pushPending({required String subject, required String token}) async {
    final pending = await store.queue(subject, onlyPending: true);
    if (pending.isEmpty) return const SyncOutcome(applied: [], pending: [], failed: []);

    final overlayId = _uuid();
    final body = {
      'overlayId': overlayId,
      'deviceId': 'flutter-offline',
      'createdAt': DateTime.now().toUtc().toIso8601String(),
      'operations': pending
          .map((advance) => {
                'operationId': advance.operationId,
                'entity': 'advance',
                'target': {'assignmentId': advance.assignmentId},
                'baseVersion': advance.baseVersion,
                'dependsOn': <String>[],
                'payload': advance.ownerPayload(),
              })
          .toList(),
    };

    for (final advance in pending) {
      await store.updateState(advance.operationId, QueueState.sending, attempts: advance.attempts + 1);
    }

    final created = await _post('/sync/overlays', token, body);
    if (created == null) return _abort(subject, pending, 'SERVICE_UNAVAILABLE');

    final pushed = await _post('/sync/overlays/$overlayId/push', token, null);
    if (pushed == null) return _abort(subject, pending, 'SERVICE_UNAVAILABLE');

    final applied = (pushed['applied'] as List?)?.cast<String>() ?? const <String>[];
    final stillPending = (pushed['pending'] as List?)?.cast<String>() ?? const <String>[];
    final failed = <({String operationId, String state, String? code})>[];
    for (final item in (pushed['failed'] as List?) ?? const []) {
      final map = item as Map<String, dynamic>;
      failed.add((operationId: item['operationId'] as String, state: map['state'] as String, code: map['code'] as String?));
    }

    for (final id in applied) {
      await store.updateState(id, QueueState.applied, clearError: true);
    }
    for (final id in stillPending) {
      await store.updateState(id, QueueState.pending);
    }
    for (final item in failed) {
      final state = QueueState.fromWire(item.state);
      await store.updateState(item.operationId, state, code: item.code, status: null);
    }
    return SyncOutcome(applied: applied, pending: stillPending, failed: failed);
  }

  Future<SyncOutcome> _abort(String subject, List<QueuedAdvance> pending, String code) async {
    for (final advance in pending) {
      await store.updateState(advance.operationId, QueueState.pending, code: code);
    }
    return SyncOutcome(applied: const [], pending: pending.map((advance) => advance.operationId).toList(), failed: const [], error: code);
  }

  Future<Map<String, dynamic>?> _post(String path, String token, Map<String, Object?>? body) async {
    try {
      final response = await _client.post(
        Uri.parse('$baseUrl$path'),
        headers: {'Authorization': 'Bearer $token', if (body != null) 'Content-Type': 'application/json'},
        body: body == null ? null : jsonEncode(body),
      );
      if (response.statusCode == 401 || response.statusCode >= 500) return null;
      if (response.body.isEmpty) return const {};
      return jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      // A lost response is not a rejection: the operation stays pending and the retry uses the same
      // operationId, which is what keeps the owner from duplicating the advance.
      return null;
    }
  }

  String _uuid() {
    // Small UUID v4 generator; the value only needs to be unique per attempt.
    final values = List<int>.generate(16, (index) => DateTime.now().microsecondsSinceEpoch.toRadixString(16).codeUnitAt(index % 8) & 0xff);
    values[6] = (values[6] & 0x0f) | 0x40;
    values[8] = (values[8] & 0x3f) | 0x80;
    final hex = values.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  void dispose() => _client.close();
}
