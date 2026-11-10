import 'dart:typed_data';

const historyEvidenceTypes = {
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
};

class VehicleHistoryVehicle {
  const VehicleHistoryVehicle({
    required this.id,
    required this.plate,
    required this.make,
    required this.model,
    required this.year,
  });

  final String id;
  final String plate;
  final String make;
  final String model;
  final int year;

  factory VehicleHistoryVehicle.fromJson(Map<String, dynamic> json) =>
      VehicleHistoryVehicle(
        id: _requiredText(json, 'id'),
        plate: _requiredText(json, 'plate'),
        make: _requiredText(json, 'make'),
        model: _requiredText(json, 'model'),
        year: _requiredInt(json, 'year'),
      );

  Map<String, Object?> toJson() => {
    'id': id,
    'plate': plate,
    'make': make,
    'model': model,
    'year': year,
  };
}

class VehicleHistoryService {
  const VehicleHistoryService({
    required this.id,
    required this.recordedName,
    required this.quantity,
    required this.minutes,
  });

  final String id;
  final String recordedName;
  final int quantity;
  final int minutes;

  factory VehicleHistoryService.fromJson(Map<String, dynamic> json) =>
      VehicleHistoryService(
        id: _requiredText(json, 'id'),
        recordedName: _requiredText(json, 'recordedName'),
        quantity: _requiredInt(json, 'quantity'),
        minutes: _requiredInt(json, 'minutes'),
      );

  Map<String, Object?> toJson() => {
    'id': id,
    'recordedName': recordedName,
    'quantity': quantity,
    'minutes': minutes,
  };
}

class VehicleHistoryEvidence {
  const VehicleHistoryEvidence({
    required this.id,
    required this.fileName,
    required this.contentType,
    required this.sizeBytes,
    required this.createdAt,
    this.localPath,
  });

  final String id;
  final String fileName;
  final String contentType;
  final int sizeBytes;
  final DateTime createdAt;
  final String? localPath;

  factory VehicleHistoryEvidence.fromJson(
    Map<String, dynamic> json, {
    String? localPath,
  }) {
    final type = _requiredText(json, 'contentType');
    final size = _requiredInt(json, 'sizeBytes');
    if (!historyEvidenceTypes.contains(type) ||
        size < 1 ||
        size > 20 * 1024 * 1024) {
      throw const FormatException('Evidencia de historial inválida.');
    }
    return VehicleHistoryEvidence(
      id: _requiredText(json, 'id'),
      fileName: _requiredText(json, 'fileName'),
      contentType: type,
      sizeBytes: size,
      createdAt: DateTime.parse(_requiredText(json, 'createdAt')),
      localPath: localPath,
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'fileName': fileName,
    'contentType': contentType,
    'sizeBytes': sizeBytes,
    'createdAt': createdAt.toUtc().toIso8601String(),
  };
}

class VehicleServiceHistoryEntry {
  const VehicleServiceHistoryEntry({
    required this.orderId,
    required this.orderNumber,
    required this.servicedAt,
    required this.type,
    required this.status,
    required this.description,
    required this.observations,
    required this.receptionReason,
    required this.symptoms,
    required this.services,
    required this.evidences,
  });

  final String orderId;
  final String orderNumber;
  final DateTime servicedAt;
  final String type;
  final String status;
  final String description;
  final String observations;
  final String receptionReason;
  final String? symptoms;
  final List<VehicleHistoryService> services;
  final List<VehicleHistoryEvidence> evidences;

  factory VehicleServiceHistoryEntry.fromJson(
    Map<String, dynamic> json, {
    Map<String, String> evidencePaths = const {},
  }) {
    if (json['status'] != 'completed')
      throw const FormatException(
        'El historial solo admite intervenciones completadas.',
      );
    final rawServices = json['services'];
    final rawEvidence = json['evidences'];
    if (rawServices is! List || rawEvidence is! List)
      throw const FormatException('Detalle de historial inválido.');
    return VehicleServiceHistoryEntry(
      orderId: _requiredText(json, 'orderId'),
      orderNumber: _requiredText(json, 'orderNumber'),
      servicedAt: DateTime.parse(_requiredText(json, 'servicedAt')),
      type: _requiredText(json, 'type'),
      status: 'completed',
      description: _requiredText(json, 'description'),
      observations: _requiredText(json, 'observations'),
      receptionReason: _requiredText(json, 'receptionReason'),
      symptoms: json['symptoms'] as String?,
      services: rawServices
          .map(
            (item) => VehicleHistoryService.fromJson(
              Map<String, dynamic>.from(item as Map),
            ),
          )
          .toList(),
      evidences: rawEvidence.map((item) {
        final map = Map<String, dynamic>.from(item as Map);
        return VehicleHistoryEvidence.fromJson(
          map,
          localPath: evidencePaths[map['id']],
        );
      }).toList(),
    );
  }

  Map<String, Object?> toJson() => {
    'orderId': orderId,
    'orderNumber': orderNumber,
    'servicedAt': servicedAt.toUtc().toIso8601String(),
    'type': type,
    'status': 'completed',
    'description': description,
    'observations': observations,
    'receptionReason': receptionReason,
    'symptoms': symptoms,
    'services': services.map((item) => item.toJson()).toList(),
    'evidences': evidences.map((item) => item.toJson()).toList(),
  };

  VehicleServiceHistoryEntry withLocalPaths(Map<String, String> paths) =>
      VehicleServiceHistoryEntry(
        orderId: orderId,
        orderNumber: orderNumber,
        servicedAt: servicedAt,
        type: type,
        status: status,
        description: description,
        observations: observations,
        receptionReason: receptionReason,
        symptoms: symptoms,
        services: services,
        evidences: evidences
            .map(
              (item) => VehicleHistoryEvidence(
                id: item.id,
                fileName: item.fileName,
                contentType: item.contentType,
                sizeBytes: item.sizeBytes,
                createdAt: item.createdAt,
                localPath: paths[item.id],
              ),
            )
            .toList(),
      );
}

class VehicleHistorySnapshot {
  const VehicleHistorySnapshot({
    required this.subject,
    required this.vehicle,
    required this.fetchedAt,
    required this.truncated,
    required this.entries,
  });

  final String subject;
  final VehicleHistoryVehicle vehicle;
  final DateTime fetchedAt;
  final bool truncated;
  final List<VehicleServiceHistoryEntry> entries;

  Map<String, Object?> toJson() => {
    'subject': subject,
    'vehicle': vehicle.toJson(),
    'fetchedAt': fetchedAt.toUtc().toIso8601String(),
    'truncated': truncated,
    'entries': entries.map((item) => item.toJson()).toList(),
  };

  factory VehicleHistorySnapshot.fromJson(
    Map<String, dynamic> json, {
    Map<String, String> evidencePaths = const {},
  }) {
    final vehicleJson = Map<String, dynamic>.from(json['vehicle'] as Map);
    final rawEntries = json['entries'];
    if (rawEntries is! List ||
        rawEntries.length > 100 ||
        json['truncated'] is! bool) {
      throw const FormatException('Copia de historial inválida.');
    }
    return VehicleHistorySnapshot(
      subject: _requiredText(json, 'subject'),
      vehicle: VehicleHistoryVehicle.fromJson(vehicleJson),
      fetchedAt: DateTime.parse(_requiredText(json, 'fetchedAt')),
      truncated: json['truncated'] as bool,
      entries: rawEntries
          .map(
            (entry) => VehicleServiceHistoryEntry.fromJson(
              Map<String, dynamic>.from(entry as Map),
              evidencePaths: evidencePaths,
            ),
          )
          .toList(),
    );
  }
}

class VehicleHistoryPage {
  const VehicleHistoryPage({required this.entries, required this.truncated});
  final List<VehicleServiceHistoryEntry> entries;
  final bool truncated;
}

class DownloadedHistoryEvidence {
  const DownloadedHistoryEvidence({
    required this.fileName,
    required this.contentType,
    required this.bytes,
  });
  final String fileName;
  final String contentType;
  final Uint8List bytes;
}

String _requiredText(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty)
    throw FormatException('Campo inválido: $key');
  return value;
}

int _requiredInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! num || value is double && value % 1 != 0)
    throw FormatException('Campo inválido: $key');
  return value.toInt();
}
