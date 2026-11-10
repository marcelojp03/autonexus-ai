/// REST client for the owner (Operaciones).
///
/// The mobile client reads the agenda and the execution of the work assigned to the signed-in
/// employee, and never writes here: every write travels through MS05 with an `operationId` so a
/// retry cannot duplicate it. Errors keep the owner's own code so the UI can explain the difference
/// between "no longer yours" and "the work changed".
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import '../offline/vehicle_history.dart';

class OwnerFailure implements Exception {
  const OwnerFailure(this.status, this.code, this.message);

  final int status;
  final String code;
  final String message;

  bool get isUnauthenticated => status == 401;

  /// Public sentence for the operator; the owner's message is safe to show as-is.
  String get label => switch (code) {
    'AGENDA_ACCESS_DENIED' ||
    'AGENDA_WORK_NOT_FOUND' ||
    'EXECUTION_ACCESS_DENIED' ||
    'EXECUTION_WORK_NOT_FOUND' => 'Ya no tenés acceso a este trabajo.',
    'SERVICE_HISTORY_NOT_FOUND' ||
    'SERVICE_HISTORY_EVIDENCE_NOT_FOUND' ||
    'VEHICLE_NOT_FOUND' ||
    'FORBIDDEN' => 'No tenés permiso para consultar ese historial o evidencia.',
    'AGENDA_DEPENDENCY_UNAVAILABLE' ||
    'AGENDA_STATE_UNAVAILABLE' ||
    'PERSISTENCE_UNAVAILABLE' =>
      'El servicio no está disponible; reintentá cuando vuelva la conexión.',
    _ => message.isEmpty ? code : message,
  };

  @override
  String toString() => '$code ($status)';
}

class AgendaWorkItem {
  const AgendaWorkItem({
    required this.assignmentId,
    required this.orderId,
    required this.orderNumber,
    required this.description,
    required this.vehiclePlate,
    required this.executionStatus,
    required this.advances,
    required this.startsAt,
  });

  final String assignmentId;
  final String orderId;
  final String orderNumber;
  final String description;
  final String vehiclePlate;
  final String executionStatus;
  final int advances;
  final String startsAt;

  bool get canReceiveAdvances => executionStatus == 'in_progress';

  static AgendaWorkItem fromJson(Map<String, dynamic> json) => AgendaWorkItem(
    assignmentId: json['assignmentId'] as String,
    orderId: json['orderId'] as String,
    orderNumber: json['orderNumber'] as String,
    description: (json['description'] as String?) ?? '',
    vehiclePlate: ((json['vehicle'] as Map?)?['plate'] as String?) ?? '',
    executionStatus: (json['executionStatus'] as String?) ?? 'not_started',
    advances:
        (((json['executionProgress'] as Map?)?['advances']) as num?)?.toInt() ??
        0,
    startsAt: (json['startsAt'] as String?) ?? '',
  );
}

class EvidenceSnapshot {
  const EvidenceSnapshot({
    required this.id,
    required this.version,
    required this.state,
  });
  final String id;
  final int version;
  final String state;
}

class ExecutionSnapshot {
  const ExecutionSnapshot({
    required this.assignmentId,
    required this.orderId,
    required this.orderNumber,
    required this.status,
    required this.version,
    required this.advances,
    this.evidences = const [],
  });

  final List<EvidenceSnapshot> evidences;
  final String assignmentId;
  final String orderId;
  final String orderNumber;
  final String status;
  final int version;
  final int advances;

  static ExecutionSnapshot fromJson(Map<String, dynamic> json) =>
      ExecutionSnapshot(
        assignmentId: json['assignmentId'] as String,
        orderId: json['orderId'] as String,
        orderNumber: json['orderNumber'] as String,
        status: (json['status'] as String?) ?? 'unknown',
        version: ((json['version'] as num?) ?? 0).toInt(),
        advances: ((json['advances'] as List?) ?? const []).length,
        evidences: [
          for (final advance in (json['advances'] as List?) ?? const [])
            for (final evidence in (advance['evidences'] as List?) ?? const [])
              EvidenceSnapshot(
                id: evidence['id'] as String,
                version: (evidence['version'] as num).toInt(),
                state: evidence['state'] as String,
              ),
        ],
      );
}

class OwnerApi {
  OwnerApi({required this.baseUrl, http.Client? client})
    : _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;

  /// Works assigned to the signed-in employee for the given civil day (default: today).
  Future<List<AgendaWorkItem>> myAgenda(String token, {DateTime? day}) async {
    final date = _civilDate(day ?? DateTime.now());
    final body = await _get('/agenda/me?from=$date&to=$date', token);
    final items = (body['items'] as List?) ?? const [];
    return items
        .map((item) => AgendaWorkItem.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<EvidenceSnapshot> evidence(
    String token,
    String assignmentId,
    String evidenceId,
  ) async {
    final snapshot = await execution(token, assignmentId);
    for (final evidence in snapshot.evidences) {
      if (evidence.id == evidenceId) return evidence;
    }
    throw const OwnerFailure(
      404,
      'EVIDENCE_NOT_FOUND',
      'La evidencia no está disponible.',
    );
  }

  /// Current execution version for advances.
  Future<ExecutionSnapshot> execution(String token, String assignmentId) async {
    final body = await _get('/executions/me/$assignmentId', token);
    return ExecutionSnapshot.fromJson(body);
  }

  Future<List<VehicleHistoryVehicle>> findHistoryVehicles(
    String token,
    String search,
  ) async {
    final term = search.trim();
    if (term.length < 2 || term.length > 100)
      throw const FormatException(
        'Ingresá al menos dos caracteres para buscar.',
      );
    final query = Uri(
      queryParameters: {'search': term, 'limit': '100', 'offset': '0'},
    ).query;
    final body = await _get('/vehicles/service-history/vehicles?$query', token);
    return ((body['items'] as List?) ?? const [])
        .map(
          (item) => VehicleHistoryVehicle.fromJson(
            Map<String, dynamic>.from(item as Map),
          ),
        )
        .toList();
  }

  Future<VehicleHistoryPage> vehicleServiceHistory(
    String token,
    String vehicleId, {
    int limit = 100,
    int offset = 0,
  }) async {
    final body = await _get(
      '/vehicles/${Uri.encodeComponent(vehicleId)}/service-history?limit=$limit&offset=$offset',
      token,
    );
    final total = (body['total'] as num?)?.toInt() ?? 0;
    final items = (body['items'] as List?) ?? const [];
    return VehicleHistoryPage(
      entries: items
          .map(
            (item) => VehicleServiceHistoryEntry.fromJson(
              Map<String, dynamic>.from(item as Map),
            ),
          )
          .toList(),
      truncated: offset + items.length < total,
    );
  }

  Future<VehicleServiceHistoryEntry> vehicleServiceHistoryEntry(
    String token,
    String vehicleId,
    String orderId,
  ) async {
    final body = await _get(
      '/vehicles/${Uri.encodeComponent(vehicleId)}/service-history/${Uri.encodeComponent(orderId)}',
      token,
    );
    return VehicleServiceHistoryEntry.fromJson(body);
  }

  Future<DownloadedHistoryEvidence> downloadHistoryEvidence(
    String token,
    String vehicleId,
    String orderId,
    VehicleHistoryEvidence evidence,
  ) async {
    final uri = Uri.parse(
      '$baseUrl/vehicles/${Uri.encodeComponent(vehicleId)}/service-history/${Uri.encodeComponent(orderId)}/evidence/${Uri.encodeComponent(evidence.id)}',
    );
    late final http.Response response;
    try {
      response = await _client
          .get(
            uri,
            headers: {
              'Authorization': 'Bearer $token',
              'Cache-Control': 'no-store',
            },
          )
          .timeout(const Duration(seconds: 30));
    } catch (error) {
      throw OwnerFailure(
        0,
        'OWNER_UNREACHABLE',
        'Sin conexión con el servicio: ${error.runtimeType}',
      );
    }
    if (response.statusCode == 401)
      throw const OwnerFailure(401, 'UNAUTHENTICATED', 'La sesión venció.');
    if (response.statusCode >= 400) {
      final body = _decode(response.body);
      throw OwnerFailure(
        response.statusCode,
        (body?['code'] as String?) ?? 'HTTP_${response.statusCode}',
        (body?['message'] as String?) ?? '',
      );
    }
    final type = response.headers['content-type']
        ?.split(';')
        .first
        .trim()
        .toLowerCase();
    final cache = response.headers['cache-control']?.toLowerCase() ?? '';
    if (type != evidence.contentType ||
        !historyEvidenceTypes.contains(type) ||
        !cache.contains('no-store') ||
        response.bodyBytes.length != evidence.sizeBytes ||
        response.bodyBytes.isEmpty ||
        response.bodyBytes.length > 20 * 1024 * 1024) {
      throw const OwnerFailure(
        502,
        'HISTORY_EVIDENCE_INVALID',
        'La evidencia no coincide con el historial autorizado.',
      );
    }
    return DownloadedHistoryEvidence(
      fileName: evidence.fileName,
      contentType: type!,
      bytes: Uint8List.fromList(response.bodyBytes),
    );
  }

  /// `YYYY-MM-DD` of the device's civil date; never serialised through UTC.
  String _civilDate(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

  Future<Map<String, dynamic>> _get(String path, String token) async {
    late final http.Response response;
    try {
      response = await _client
          .get(
            Uri.parse('$baseUrl$path'),
            headers: {'Authorization': 'Bearer $token'},
          )
          .timeout(const Duration(seconds: 20));
    } catch (error) {
      throw OwnerFailure(
        0,
        'OWNER_UNREACHABLE',
        'Sin conexión con el servicio: ${error.runtimeType}',
      );
    }
    if (response.statusCode == 401) {
      throw const OwnerFailure(401, 'UNAUTHENTICATED', 'La sesión venció.');
    }
    final decoded = _decode(response.body);
    if (response.statusCode >= 400) {
      final code =
          (decoded?['code'] as String?) ?? 'HTTP_${response.statusCode}';
      final message = (decoded?['message'] as String?) ?? '';
      throw OwnerFailure(response.statusCode, code, message);
    }
    return decoded ?? const {};
  }

  Map<String, dynamic>? _decode(String raw) {
    if (raw.isEmpty) return null;
    try {
      final value = jsonDecode(raw);
      return value is Map<String, dynamic> ? value : null;
    } catch (_) {
      return null;
    }
  }

  void dispose() => _client.close();
}
