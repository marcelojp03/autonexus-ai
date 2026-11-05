/// Synchronisation through MS05.
///
/// The client never talks to the owner services directly and never stores the bearer: the token is
/// passed per call, the overlay carries one `operationId` per advance (so a retry cannot duplicate
/// it) and the answer decides the queue state. Connectivity is only a hint: the request result is
/// what moves an advance out of `pending`.
library;

import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import '../api/owner_api.dart';
import 'offline_models.dart';
import 'offline_store.dart';

class SyncOutcome {
  const SyncOutcome({
    required this.applied,
    required this.pending,
    required this.failed,
    this.error,
  });

  final List<String> applied;
  final List<String> pending;
  final List<({String operationId, String state, String? code})> failed;
  final String? error;
}

class _OperationResult {
  const _OperationResult({
    required this.state,
    required this.status,
    required this.code,
    this.body,
    this.overlayId,
  });

  final String state;
  final int? status;
  final String? code;
  final Map<String, dynamic>? body;
  final String? overlayId;
}

class _HttpResult {
  const _HttpResult(this.statusCode, this.body);

  final int statusCode;
  final Map<String, dynamic>? body;
}

class _UploadAuthorization {
  const _UploadAuthorization({required this.url, required this.headers});

  final String url;
  final Map<String, String> headers;
}

typedef EvidenceReader = Future<EvidenceSnapshot> Function(
  String token,
  String assignmentId,
  String evidenceId,
);

class SyncService {
  SyncService({
    required this.baseUrl,
    required this.store,
    http.Client? client,
    http.Client? uploadClient,
    this.readEvidence,
  }) : _client = client ?? http.Client(),
       _uploadClient = uploadClient ?? http.Client();

  final String baseUrl;
  final OfflineStore store;
  final http.Client _client;
  final http.Client _uploadClient;
  final EvidenceReader? readEvidence;

  /// Pushes the pending queue of one user and updates every row with the owner's answer.
  ///
  /// A 401 or a transport failure leaves the rows `pending` (the session is renewed and the same
  /// operationId is retried); a conflict or a rejection is terminal and visible.
  Future<SyncOutcome> pushPending({
    required String subject,
    required String token,
  }) async {
    final pending = await store.queue(subject, onlyPending: true);
    if (pending.isEmpty) {
      return const SyncOutcome(applied: [], pending: [], failed: []);
    }
    final plain = pending
        .where((advance) => advance.photoPath == null)
        .toList();
    final withPhoto = pending
        .where((advance) => advance.photoPath != null)
        .toList();
    final applied = <String>[];
    final stillPending = <String>[];
    final failed = <({String operationId, String state, String? code})>[];
    String? error;
    if (plain.isNotEmpty) {
      final result = await _pushPlain(subject, token, plain);
      applied.addAll(result.applied);
      stillPending.addAll(result.pending);
      failed.addAll(result.failed);
      error = result.error;
    }
    for (final advance in withPhoto) {
      await store.updateState(
        advance.operationId,
        QueueState.sending,
        attempts: advance.attempts + 1,
      );
      final result = await _pushWithPhoto(token, advance);
      applied.addAll(result.applied);
      stillPending.addAll(result.pending);
      failed.addAll(result.failed);
      error ??= result.error;
    }
    return SyncOutcome(
      applied: applied,
      pending: stillPending,
      failed: failed,
      error: error,
    );
  }

  Future<SyncOutcome> _pushPlain(
    String subject,
    String token,
    List<QueuedAdvance> pending,
  ) async {
    final outcomes = <SyncOutcome>[];
    for (final advance in pending) {
      await store.updateState(
        advance.operationId,
        QueueState.sending,
        attempts: advance.attempts + 1,
      );
      final result = await _applyOperation(token, advance.operationId, {
        'operationId': advance.operationId,
        'entity': 'advance',
        'target': {'assignmentId': advance.assignmentId},
        'baseVersion': advance.baseVersion,
        'dependsOn': <String>[],
        'payload': advance.ownerPayload(),
      });
      outcomes.add(
        await _finish(
          advance,
          result.state,
          code: result.code,
          status: result.status,
        ),
      );
    }
    return SyncOutcome(
      applied: outcomes.expand((x) => x.applied).toList(),
      pending: outcomes.expand((x) => x.pending).toList(),
      failed: outcomes.expand((x) => x.failed).toList(),
      error: outcomes.map((x) => x.error).whereType<String>().firstOrNull,
    );
  }

  Future<SyncOutcome> _pushWithPhoto(
    String token,
    QueuedAdvance advance,
  ) async {
    final operationId = advance.operationId;
    try {
      final path = advance.photoPath;
      if (path == null) {
        return await _finish(
          advance,
          'rejected',
          code: 'LOCAL_EVIDENCE_MISSING',
        );
      }
      final file = File(path);
      if (!await file.exists()) {
        return await _finish(
          advance,
          'rejected',
          code: 'LOCAL_EVIDENCE_MISSING',
        );
      }
      final bytes = await file.readAsBytes();
      final digest = sha256.convert(bytes);
      final imageHash = digest.toString();
      if (advance.photoSha256 != null && advance.photoSha256 != imageHash) {
        return await _finish(
          advance,
          'rejected',
          code: 'LOCAL_EVIDENCE_CHECKSUM_MISMATCH',
        );
      }
      final checksumBase64 = base64Encode(digest.bytes);

      var ownerAdvanceId = advance.ownerAdvanceId;
      if (ownerAdvanceId == null) {
        final result = await _applyOperation(token, advance.operationId, {
          'operationId': operationId,
          'entity': 'advance',
          'target': {'assignmentId': advance.assignmentId},
          'baseVersion': advance.baseVersion,
          'dependsOn': <String>[],
          'payload': advance.ownerPayload(),
        });
        if (result.state != 'applied') {
          return await _finish(
            advance,
            result.state,
            code: result.code,
            status: result.status,
          );
        }
        ownerAdvanceId = _nestedString(result.body, 'advance', 'id');
        if (ownerAdvanceId == null) {
          final stored = await _readStoredOperation(token, operationId);
          if (stored?.state == 'applied') {
            ownerAdvanceId = _nestedString(stored?.body, 'advance', 'id');
          }
        }
        if (ownerAdvanceId == null) {
          return await _finish(
            advance,
            'pending',
            code: 'ADVANCE_RESULT_UNAVAILABLE',
          );
        }
        await store.updateSyncProgress(
          operationId,
          ownerAdvanceId: ownerAdvanceId,
        );
      }

      var evidenceId = advance.evidenceId;
      var attempt = advance.evidenceAttempt;
      var evidenceState = advance.evidenceState;
      _UploadAuthorization? upload;
      if (evidenceId == null) {
        final result = await _authorizeEvidence(
          token,
          advance,
          ownerAdvanceId,
          bytes,
          imageHash,
          checksumBase64,
        );
        if (result.state != 'applied') {
          return await _finish(
            advance,
            result.state,
            code: result.code,
            status: result.status,
          );
        }
        evidenceId = _nestedString(result.body, 'evidence', 'id');
        attempt = _nestedInt(result.body, 'evidence', 'attempt') ?? 1;
        if (evidenceId == null) {
          return await _finish(
            advance,
            'pending',
            code: 'EVIDENCE_RESULT_UNAVAILABLE',
          );
        }
        evidenceState = 'authorized';
        await store.updateSyncProgress(
          operationId,
          evidenceId: evidenceId,
          evidenceAttempt: attempt,
          evidenceState: evidenceState,
        );
        upload = _uploadAuthorization(result.body);
      }

      if (evidenceState == 'authorized' && upload == null) {
        // Recover the ambiguous case after Android was killed while the signed upload was in flight.
        final confirmation = await _confirmEvidence(
          token,
          advance,
          evidenceId,
          attempt,
        );
        if (confirmation.state == 'applied') {
          evidenceState = 'available';
          await store.updateSyncProgress(
            operationId,
            evidenceState: evidenceState,
          );
        } else if (confirmation.state == 'needs-reupload') {
          evidenceState = 'failed';
          await store.updateSyncProgress(
            operationId,
            evidenceState: evidenceState,
            clearEvidenceConfirmVersion: true,
          );
        } else {
          return await _finish(
            advance,
            confirmation.state,
            code: confirmation.code,
            status: confirmation.status,
          );
        }
      }

      if (evidenceState == 'failed' ||
          advance.state == QueueState.needsReupload) {
        if (attempt >= 5) {
          return await _finish(
            advance,
            'rejected',
            code: 'EVIDENCE_ATTEMPTS_EXHAUSTED',
            status: 409,
          );
        }
        final authorization = await _reauthorizeEvidence(
          token,
          advance,
          evidenceId,
          attempt + 1,
          bytes,
          imageHash,
          checksumBase64,
        );
        if (authorization.state != 'applied') {
          return await _finish(
            advance,
            authorization.state,
            code: authorization.code,
            status: authorization.status,
          );
        }
        attempt =
            _nestedInt(authorization.body, 'evidence', 'attempt') ??
            attempt + 1;
        evidenceId =
            _nestedString(authorization.body, 'evidence', 'id') ?? evidenceId;
        evidenceState = 'authorized';
        upload = _uploadAuthorization(authorization.body);
        await store.updateSyncProgress(
          operationId,
          evidenceId: evidenceId,
          evidenceAttempt: attempt,
          evidenceState: evidenceState,
          clearEvidenceConfirmVersion: true,
        );
      }

      if (evidenceState != 'available' && evidenceState != 'uploaded') {
        if (upload == null) {
          return await _finish(
            advance,
            'needs-reupload',
            code: 'EVIDENCE_UPLOAD_URL_UNAVAILABLE',
          );
        }
        final uploaded = await _putEvidence(upload, bytes);
        if (uploaded == 412 ||
            (uploaded != null && uploaded >= 200 && uploaded < 300)) {
          evidenceState = 'uploaded';
          await store.updateSyncProgress(
            operationId,
            evidenceState: evidenceState,
          );
        } else if (uploaded == null || uploaded >= 500) {
          // A lost PUT response is ambiguous; next sync asks the owner to confirm before reuploading.
          return await _finish(
            advance,
            'pending',
            code: 'EVIDENCE_UPLOAD_UNCONFIRMED',
            status: uploaded,
          );
        } else {
          await store.updateSyncProgress(
            operationId,
            evidenceState: 'failed',
            clearEvidenceConfirmVersion: true,
          );
          return await _finish(
            advance,
            'needs-reupload',
            code: 'EVIDENCE_UPLOAD_FAILED',
            status: uploaded,
          );
        }
      }

      if (evidenceState != 'available') {
        final confirmation = await _confirmEvidence(
          token,
          advance,
          evidenceId,
          attempt,
        );
        if (confirmation.state != 'applied') {
          final failed = confirmation.state == 'needs-reupload';
          if (failed) {
            await store.updateSyncProgress(
              operationId,
              evidenceState: 'failed',
              clearEvidenceConfirmVersion: true,
            );
          }
          return await _finish(
            advance,
            confirmation.state,
            code: confirmation.code,
            status: confirmation.status,
          );
        }
        evidenceState = 'available';
        await store.updateSyncProgress(
          operationId,
          evidenceState: evidenceState,
        );
      }

      if (advance.runId != null &&
          advance.modelVersion != null &&
          advance.labels.isNotEmpty &&
          advance.inferenceState != 'applied') {
        final inferenceId = _deriveOperationId('$operationId:client-inference');
        final clientInference = {
          'runId': advance.runId,
          'modelVersion': advance.modelVersion,
          'imageSha256': imageHash,
          'labels': [
            for (final entry in advance.labels.entries)
              {'name': entry.key, 'score': entry.value},
          ],
          if (advance.humanReviewLabels != null)
            'humanReview': {
              'modelVersion': advance.modelVersion,
              'labels': advance.humanReviewLabels,
            },
        };
        final result = await _applyOperation(token, advance.operationId, {
          'operationId': inferenceId,
          'entity': 'client-inference',
          'target': {
            'assignmentId': advance.assignmentId,
            'evidenceId': evidenceId,
          },
          'baseVersion': advance.baseVersion,
          'dependsOn': <String>[],
          'payload': <String, Object?>{},
          'clientInference': clientInference,
        });
        if (result.state != 'applied') {
          await store.updateSyncProgress(
            operationId,
            inferenceState: result.state,
          );
          return await _finish(
            advance,
            result.state,
            code: result.code,
            status: result.status,
          );
        }
        await store.updateSyncProgress(operationId, inferenceState: 'applied');
      }

      return await _finish(advance, 'applied');
    } catch (_) {
      return _finish(advance, 'pending', code: 'SERVICE_UNAVAILABLE');
    }
  }

  Future<_OperationResult> _authorizeEvidence(
    String token,
    QueuedAdvance advance,
    String advanceId,
    List<int> bytes,
    String imageHash,
    String checksumBase64,
  ) => _applyOperation(token, advance.operationId, {
    'operationId': _deriveOperationId(
      '${advance.operationId}:evidence-authorize',
    ),
    'entity': 'evidence-authorize',
    'target': {'assignmentId': advance.assignmentId, 'advanceId': advanceId},
    'baseVersion': advance.baseVersion,
    'dependsOn': <String>[],
    'file': {
      'sha256': imageHash,
      'bytes': bytes.length,
      'contentType': 'image/jpeg',
    },
    'payload': {
      'operationId': _deriveOperationId(
        '${advance.operationId}:evidence-authorize',
      ),
      'fileName': 'inspection.jpg',
      'contentType': 'image/jpeg',
      'sizeBytes': bytes.length,
      'checksumSha256': checksumBase64,
    },
  });

  Future<_OperationResult> _reauthorizeEvidence(
    String token,
    QueuedAdvance advance,
    String evidenceId,
    int attempt,
    List<int> bytes,
    String imageHash,
    String checksumBase64,
  ) async {
    final retryId = _deriveOperationId(
      '${advance.operationId}:evidence-reauthorize:$attempt',
    );
    final saved = await store.syncRequest(retryId);
    if (saved != null) {
      return _applyOperation(
        token,
        advance.operationId,
        Map<String, Object?>.from((saved['operations'] as List).single as Map),
      );
    }
    final readVersion = readEvidence;
    if (readVersion == null) {
      return const _OperationResult(
        state: 'pending',
        status: 503,
        code: 'OWNER_VERSION_UNAVAILABLE',
      );
    }
    final version = (await readVersion(
      token,
      advance.assignmentId,
      evidenceId,
    )).version;
    final operationId = _deriveOperationId(
      '${advance.operationId}:evidence-reauthorize:$attempt',
    );
    return _applyOperation(token, advance.operationId, {
      'operationId': operationId,
      'entity': 'evidence-reauthorize',
      'target': {
        'assignmentId': advance.assignmentId,
        'evidenceId': evidenceId,
      },
      'baseVersion': version,
      'dependsOn': <String>[],
      'file': {
        'sha256': imageHash,
        'bytes': bytes.length,
        'contentType': 'image/jpeg',
      },
      'payload': {
        'operationId': operationId,
        'expectedVersion': version,
        'fileName': 'inspection.jpg',
        'contentType': 'image/jpeg',
        'sizeBytes': bytes.length,
        'checksumSha256': checksumBase64,
      },
    });
  }

  Future<_OperationResult> _confirmEvidence(
    String token,
    QueuedAdvance advance,
    String evidenceId,
    int attempt,
  ) async {
    final queued = await store.queue(advance.subject);
    var latest = advance;
    for (final item in queued) {
      if (item.operationId == advance.operationId) {
        latest = item;
        break;
      }
    }
    var version = latest.evidenceConfirmVersion;
    if (version == null) {
      final readVersion = readEvidence;
      if (readVersion == null) {
        return const _OperationResult(
          state: 'pending',
          status: 503,
          code: 'OWNER_VERSION_UNAVAILABLE',
        );
      }
      version = (await readVersion(
        token,
        advance.assignmentId,
        evidenceId,
      )).version;
      await store.updateSyncProgress(
        advance.operationId,
        evidenceConfirmVersion: version,
      );
    }
    final operationId = _deriveOperationId(
      '${advance.operationId}:evidence-confirm:$attempt',
    );
    return _applyOperation(token, advance.operationId, {
      'operationId': operationId,
      'entity': 'evidence-confirm',
      'target': {
        'assignmentId': advance.assignmentId,
        'evidenceId': evidenceId,
      },
      'baseVersion': version,
      'dependsOn': <String>[],
      'payload': {'operationId': operationId, 'expectedVersion': version},
    });
  }

  Future<_OperationResult> _applyOperation(
    String token,
    String parentId,
    Map<String, Object?> operation,
  ) async {
    final operationId = operation['operationId']! as String;
    final saved = await store.syncRequest(operationId);
    final overlay =
        saved ??
        {
          'overlayId': _deriveOperationId('$operationId:overlay'),
          'deviceId': 'flutter-offline',
          'createdAt': DateTime.now().toUtc().toIso8601String(),
          'operations': [operation],
        };
    await store.saveSyncRequest(operationId, parentId, overlay);
    var overlayId = overlay['overlayId'] as String;
    final created = await _request('POST', '/sync/overlays', token, overlay);
    if (created == null) {
      return const _OperationResult(
        state: 'pending',
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
      );
    }
    if (created.statusCode >= 400) return _failedHttp(created);
    final replayed =
        created.body?['replayed'] == true ||
        ((created.body?['replayedOperations'] as List?)?.contains(operationId) ??
            false);
    if (replayed) {
      final stored = await _readStoredOperation(token, operationId);
      if (stored == null) {
        return const _OperationResult(
          state: 'pending',
          status: 503,
          code: 'SYNC_RESULT_UNAVAILABLE',
        );
      }
      if (['applied', 'conflict', 'rejected'].contains(stored.state)) {
        return stored;
      }
      if (stored.overlayId == null) return stored;
      overlayId = stored.overlayId!;
    }

    final pushed = await _request(
      'POST',
      '/sync/overlays/$overlayId/push',
      token,
      null,
    );
    if (pushed == null) {
      return await _readStoredOperation(token, operationId) ??
          const _OperationResult(
            state: 'pending',
            status: 503,
            code: 'SERVICE_UNAVAILABLE',
          );
    }
    if (pushed.statusCode >= 400) return _failedHttp(pushed);
    final results = (pushed.body?['results'] as List?) ?? const [];
    for (final raw in results) {
      if (raw is! Map<String, dynamic> || raw['operationId'] != operationId) {
        continue;
      }
      Map<String, dynamic>? failure;
      for (final item in (pushed.body?['failed'] as List?) ?? const []) {
        if (item is Map<String, dynamic> &&
            item['operationId'] == operationId) {
          failure = item;
          break;
        }
      }
      final applied = ((pushed.body?['applied'] as List?) ?? const []).contains(
        operationId,
      );
      final state = applied
          ? 'applied'
          : (failure?['state'] as String?) ?? 'pending';
      return _OperationResult(
        state: state,
        status: (raw['status'] as num?)?.toInt(),
        code: raw['code'] as String?,
        body: raw['body'] is Map<String, dynamic>
            ? raw['body'] as Map<String, dynamic>
            : null,
      );
    }
    if (((pushed.body?['applied'] as List?) ?? const []).contains(
          operationId,
        ) &&
        operation['entity'] == 'advance') {
      return const _OperationResult(state: 'applied', status: 200, code: null);
    }
    Map<String, dynamic>? failed;
    for (final item in (pushed.body?['failed'] as List?) ?? const []) {
      if (item is Map<String, dynamic> && item['operationId'] == operationId) {
        failed = item;
        break;
      }
    }
    if (failed != null) {
      return _OperationResult(
        state: failed['state'] as String,
        status: (failed['status'] as num?)?.toInt(),
        code: failed['code'] as String?,
      );
    }
    return await _readStoredOperation(token, operationId) ??
        const _OperationResult(
          state: 'pending',
          status: 503,
          code: 'SYNC_RESULT_UNAVAILABLE',
        );
  }

  Future<_OperationResult?> _readStoredOperation(
    String token,
    String operationId,
  ) async {
    final response = await _request(
      'GET',
      '/sync/operations/${Uri.encodeComponent(operationId)}',
      token,
      null,
    );
    final operation = response?.body?['operation'];
    if (response == null ||
        response.statusCode >= 400 ||
        operation is! Map<String, dynamic>) {
      return null;
    }
    final lastResult = operation['lastResult'] as Map<String, dynamic>?;
    final lastBody = operation['lastBody'] as Map<String, dynamic>?;
    final state = (operation['state'] as String?) ?? 'pending';
    return _OperationResult(
      state: state == 'sending' ? 'pending' : state,
      status: (lastResult?['status'] as num?)?.toInt(),
      code: lastResult?['code'] as String?,
      body: lastBody,
      overlayId: operation['overlayId'] as String?,
    );
  }

  Future<_HttpResult?> _request(
    String method,
    String path,
    String token,
    Map<String, Object?>? body,
  ) async {
    try {
      final request = http.Request(method, Uri.parse(baseUrl + path));
      request.headers['Authorization'] = 'Bearer $token';
      if (body != null) {
        request.headers['Content-Type'] = 'application/json';
        request.body = jsonEncode(body);
      }
      final streamed = await _client
          .send(request)
          .timeout(const Duration(seconds: 20));
      final response = await http.Response.fromStream(streamed);
      Map<String, dynamic>? decoded;
      if (response.body.isNotEmpty) {
        final value = jsonDecode(response.body);
        if (value is Map<String, dynamic>) decoded = value;
      }
      return _HttpResult(response.statusCode, decoded);
    } catch (_) {
      return null;
    }
  }

  _OperationResult _failedHttp(_HttpResult response) {
    final code =
        response.body?['code'] as String? ?? 'HTTP_${response.statusCode}';
    final state = response.statusCode == 401 || response.statusCode >= 500
        ? 'pending'
        : [
            'EVIDENCE_UPLOAD_EXPIRED',
            'EVIDENCE_NOT_PENDING',
            'EVIDENCE_OBJECT_MISSING',
          ].contains(code)
        ? 'needs-reupload'
        : response.statusCode == 409
        ? 'conflict'
        : 'rejected';
    return _OperationResult(
      state: state,
      status: response.statusCode,
      code: code,
      body: response.body,
    );
  }

  _UploadAuthorization? _uploadAuthorization(Map<String, dynamic>? body) {
    final raw = body?['upload'];
    if (raw is! Map<String, dynamic>) return null;
    final url = raw['url'] as String?;
    if (url == null || url.isEmpty || url == '[redacted]') return null;
    if ((raw['method'] as String? ?? 'PUT') != 'PUT') return null;
    var rawHeaders = raw['headers'] ?? raw['headersJson'];
    if (rawHeaders is String) {
      try {
        rawHeaders = jsonDecode(rawHeaders);
      } catch (_) {
        return null;
      }
    }
    if (rawHeaders is! Map) return null;
    final headers = <String, String>{};
    for (final entry in rawHeaders.entries) {
      if (entry.key is! String || entry.value is! String) return null;
      if ((entry.key as String).toLowerCase() == 'authorization') return null;
      headers[entry.key as String] = entry.value as String;
    }
    return _UploadAuthorization(url: url, headers: headers);
  }

  Future<int?> _putEvidence(
    _UploadAuthorization upload,
    List<int> bytes,
  ) async {
    try {
      final response = await _uploadClient
          .put(Uri.parse(upload.url), headers: upload.headers, body: bytes)
          .timeout(const Duration(seconds: 30));
      return response.statusCode;
    } catch (_) {
      return null;
    }
  }

  Future<SyncOutcome> _finish(
    QueuedAdvance advance,
    String state, {
    String? code,
    int? status,
  }) async {
    final queueState = QueueState.fromWire(state);
    await store.updateState(
      advance.operationId,
      queueState,
      code: code,
      status: status,
      clearError: queueState == QueueState.applied,
    );
    if (queueState == QueueState.applied) {
      return SyncOutcome(
        applied: [advance.operationId],
        pending: const [],
        failed: const [],
      );
    }
    if (queueState == QueueState.pending) {
      return SyncOutcome(
        applied: const [],
        pending: [advance.operationId],
        failed: const [],
        error: code ?? 'SERVICE_UNAVAILABLE',
      );
    }
    final failure = (
      operationId: advance.operationId,
      state: queueState.wire,
      code: code,
    );
    return SyncOutcome(
      applied: const [],
      pending: queueState == QueueState.needsReupload
          ? [advance.operationId]
          : const [],
      failed: [failure],
    );
  }

  String? _nestedString(Map<String, dynamic>? body, String parent, String key) {
    final value = body?[parent];
    return value is Map<String, dynamic> ? value[key] as String? : null;
  }

  int? _nestedInt(Map<String, dynamic>? body, String parent, String key) {
    final value = body?[parent];
    final nested = value is Map<String, dynamic> ? value[key] : null;
    return nested is num ? nested.toInt() : null;
  }

  String _deriveOperationId(String seed) {
    final values = sha256.convert(utf8.encode(seed)).bytes.take(16).toList();
    values[6] = (values[6] & 0x0f) | 0x50;
    values[8] = (values[8] & 0x3f) | 0x80;
    return _formatUuid(values);
  }

  String _formatUuid(List<int> values) {
    final hex = values
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  void dispose() {
    _client.close();
    _uploadClient.close();
  }
}
