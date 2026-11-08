/// Domain types of the offline journey.
///
/// The queue is the heart of the feature: an advance is created while there is no network, it keeps
/// its own `operationId` (the idempotency unit) and it moves through states that the UI can show
/// without inventing anything.
library;

import 'dart:convert';

enum QueueState {
  /// Saved locally, never sent. The default after capturing an advance offline.
  pending,

  /// A request is in flight (or was when the app died); it is retried with the same operationId.
  sending,

  /// The owner confirmed the change (or answered replay for this operationId).
  applied,

  /// The version of the work changed: nothing was written and a human has to look.
  conflict,

  /// The owner refused by rule or authorisation; the code is kept so the UI can explain it.
  rejected,

  /// The upload authorisation expired or the object is missing: a new one is needed for the same
  /// evidence, not a new advance.
  needsReupload;

  String get wire => switch (this) {
    QueueState.pending => 'pending',
    QueueState.sending => 'sending',
    QueueState.applied => 'applied',
    QueueState.conflict => 'conflict',
    QueueState.rejected => 'rejected',
    QueueState.needsReupload => 'needs-reupload',
  };

  static QueueState fromWire(String value) => switch (value) {
    'sending' => QueueState.sending,
    'applied' => QueueState.applied,
    'conflict' => QueueState.conflict,
    'rejected' => QueueState.rejected,
    'needs-reupload' => QueueState.needsReupload,
    _ => QueueState.pending,
  };

  bool get isTerminal =>
      this == QueueState.applied ||
      this == QueueState.conflict ||
      this == QueueState.rejected;
}

/// A work item prepared while online and consulted later without network.
class PreparedWork {
  const PreparedWork({
    required this.subject,
    required this.assignmentId,
    required this.orderId,
    required this.orderNumber,
    required this.version,
    required this.preparedAt,
    required this.expiresAt,
  });

  final String subject;
  final String assignmentId;
  final String orderId;
  final String orderNumber;
  final int version;
  final DateTime preparedAt;
  final DateTime expiresAt;

  bool isUsableAt(DateTime now) => now.isBefore(expiresAt);

  Map<String, Object?> toRow() => {
    'subject': subject,
    'assignment_id': assignmentId,
    'order_id': orderId,
    'order_number': orderNumber,
    'version': version,
    'prepared_at': preparedAt.toUtc().toIso8601String(),
    'expires_at': expiresAt.toUtc().toIso8601String(),
  };

  static PreparedWork fromRow(Map<String, Object?> row) => PreparedWork(
    subject: row['subject']! as String,
    assignmentId: row['assignment_id']! as String,
    orderId: row['order_id']! as String,
    orderNumber: row['order_number']! as String,
    version: row['version']! as int,
    preparedAt: DateTime.parse(row['prepared_at']! as String),
    expiresAt: DateTime.parse(row['expires_at']! as String),
  );
}

class InspectionReview {
  InspectionReview({
    required this.mode,
    required this.reason,
    required this.interpretation,
    required this.reviewedAt,
    this.labels = const [],
  }) {
    if (!const ['manual', 'assisted'].contains(mode) ||
        !reasons.contains(reason) ||
        interpretation.trim().length < 3 ||
        interpretation.length > 1600 ||
        labels.toSet().length != labels.length ||
        labels.any((label) => !labelCodes.contains(label))) {
      throw const FormatException('Revisión de inspección inválida.');
    }
  }
  static const labelCodes = ['crack', 'dent', 'glass_shatter', 'scratch'];
  static const reasons = [
    'operator_manual',
    'model_unavailable',
    'inference_failed',
    'insufficient_resources',
    'below_thresholds',
    'input_rejected',
  ];
  final String mode;
  final String reason;
  final String interpretation;
  final List<String> labels;
  final DateTime reviewedAt;
  String get ownerDescription =>
      'Inspección humana · modo: $mode · motivo: $reason · etiquetas: ${labels.isEmpty ? "ninguna indicada" : labels.join(", ")}\n$interpretation';
  Map<String, Object?> toJson() => {
    'schemaVersion': 1,
    'mode': mode,
    'reason': reason,
    'interpretation': interpretation,
    'labels': labels,
    'reviewedAt': reviewedAt.toUtc().toIso8601String(),
  };
  static InspectionReview fromJson(Map<String, dynamic> json) {
    if (json['schemaVersion'] != 1) {
      throw const FormatException('Revisión incompatible.');
    }
    return InspectionReview(
      mode: json['mode'] as String,
      reason: json['reason'] as String,
      interpretation: json['interpretation'] as String,
      labels: (json['labels'] as List? ?? []).cast<String>(),
      reviewedAt: DateTime.parse(json['reviewedAt'] as String),
    );
  }
}

/// A pending advance with its local photograph and the client inference, if any.
class QueuedAdvance {
  const QueuedAdvance({
    required this.operationId,
    required this.subject,
    required this.assignmentId,
    required this.baseVersion,
    required this.description,
    required this.minutesWorked,
    required this.createdAt,
    required this.state,
    this.inspectionReview,
    this.photoPath,
    this.photoSha256,
    this.humanReviewLabels,
    this.humanReviewedAt,
    this.runId,
    this.modelVersion,
    this.labels = const {},
    this.lastCode,
    this.lastStatus,
    this.attempts = 0,
    this.ownerAdvanceId,
    this.evidenceId,
    this.evidenceAttempt = 0,
    this.evidenceState,
    this.evidenceConfirmVersion,
    this.inferenceState,
  });

  final String operationId;
  final String subject;
  final String assignmentId;
  final int baseVersion;
  final String description;
  final int minutesWorked;
  final DateTime createdAt;
  final QueueState state;

  final InspectionReview? inspectionReview;
  /// Private file inside the app's documents directory; never the gallery.
  final String? photoPath;
  final String? photoSha256;
  final List<String>? humanReviewLabels;
  final DateTime? humanReviewedAt;
  final String? runId;
  final String? modelVersion;
  final Map<String, double> labels;
  final String? lastCode;
  final int? lastStatus;
  final int attempts;
  final String? ownerAdvanceId;
  final String? evidenceId;
  final int evidenceAttempt;
  final String? evidenceState;
  final int? evidenceConfirmVersion;
  final String? inferenceState;

  QueuedAdvance copyWith({
    QueueState? state,
    String? lastCode,
    int? lastStatus,
    int? attempts,
  }) => QueuedAdvance(
    operationId: operationId,
    subject: subject,
    assignmentId: assignmentId,
    baseVersion: baseVersion,
    description: description,
    minutesWorked: minutesWorked,
    createdAt: createdAt,
    state: state ?? this.state,
    inspectionReview: inspectionReview,
    photoPath: photoPath,
    photoSha256: photoSha256,
    humanReviewLabels: humanReviewLabels,
    humanReviewedAt: humanReviewedAt,
    runId: runId,
    modelVersion: modelVersion,
    labels: labels,
    lastCode: lastCode ?? this.lastCode,
    lastStatus: lastStatus ?? this.lastStatus,
    attempts: attempts ?? this.attempts,
    ownerAdvanceId: ownerAdvanceId,
    evidenceId: evidenceId,
    evidenceAttempt: evidenceAttempt,
    evidenceState: evidenceState,
    evidenceConfirmVersion: evidenceConfirmVersion,
    inferenceState: inferenceState,
  );

  Map<String, Object?> toRow() => {
    'operation_id': operationId,
    'subject': subject,
    'assignment_id': assignmentId,
    'base_version': baseVersion,
    'description': description,
    'minutes_worked': minutesWorked,
    'created_at': createdAt.toUtc().toIso8601String(),
    'state': state.wire,
    'inspection_review_json': inspectionReview == null
        ? null
        : jsonEncode(inspectionReview!.toJson()),
    'photo_path': photoPath,
    'photo_sha256': photoSha256,
    'human_labels_json': humanReviewLabels?.join(','),
    'human_reviewed_at': humanReviewedAt?.toUtc().toIso8601String(),
    'run_id': runId,
    'model_version': modelVersion,
    'labels_json': labels.isEmpty ? null : _labelsToJson(labels),
    'last_code': lastCode,
    'last_status': lastStatus,
    'attempts': attempts,
    'owner_advance_id': ownerAdvanceId,
    'evidence_id': evidenceId,
    'evidence_attempt': evidenceAttempt,
    'evidence_state': evidenceState,
    'evidence_confirm_version': evidenceConfirmVersion,
    'inference_state': inferenceState,
  };

  static QueuedAdvance fromRow(Map<String, Object?> row) => QueuedAdvance(
    operationId: row['operation_id']! as String,
    subject: row['subject']! as String,
    assignmentId: row['assignment_id']! as String,
    baseVersion: row['base_version']! as int,
    description: row['description']! as String,
    minutesWorked: row['minutes_worked']! as int,
    createdAt: DateTime.parse(row['created_at']! as String),
    state: QueueState.fromWire(row['state']! as String),
    inspectionReview: row['inspection_review_json'] == null
        ? null
        : InspectionReview.fromJson(
            jsonDecode(row['inspection_review_json'] as String)
                as Map<String, dynamic>,
          ),
    photoPath: row['photo_path'] as String?,
    photoSha256: row['photo_sha256'] as String?,
    humanReviewLabels: row['human_labels_json'] == null
        ? null
        : (row['human_labels_json'] as String).isEmpty
        ? const []
        : (row['human_labels_json'] as String).split(','),
    humanReviewedAt: row['human_reviewed_at'] == null
        ? null
        : DateTime.parse(row['human_reviewed_at']! as String),
    runId: row['run_id'] as String?,
    modelVersion: row['model_version'] as String?,
    labels: _labelsFromJson(row['labels_json'] as String?),
    lastCode: row['last_code'] as String?,
    lastStatus: row['last_status'] as int?,
    attempts: (row['attempts'] as int?) ?? 0,
    ownerAdvanceId: row['owner_advance_id'] as String?,
    evidenceId: row['evidence_id'] as String?,
    evidenceAttempt: (row['evidence_attempt'] as int?) ?? 0,
    evidenceState: row['evidence_state'] as String?,
    evidenceConfirmVersion: row['evidence_confirm_version'] as int?,
    inferenceState: row['inference_state'] as String?,
  );

  /// Payload the owner expects; `operationId` and `expectedVersion` are the idempotency and the
  /// optimistic check, so they travel inside the body as the REST contract requires.
  Map<String, Object?> ownerPayload() => {
    'operationId': operationId,
    'expectedVersion': baseVersion,
    'description': description,
    'minutesWorked': minutesWorked,
  };

  static String _labelsToJson(Map<String, double> labels) =>
      labels.entries.map((entry) => '${entry.key}:${entry.value}').join(',');

  static Map<String, double> _labelsFromJson(String? raw) {
    if (raw == null || raw.isEmpty) return const {};
    return {
      for (final part in raw.split(','))
        if (part.contains(':'))
          part.split(':').first: double.parse(part.split(':').last),
    };
  }
}

class StagedPhoto {
  const StagedPhoto({
    required this.subject,
    required this.assignmentId,
    required this.path,
    required this.sha256,
    required this.bytes,
  });

  final String subject;
  final String assignmentId;
  final String path;
  final String sha256;
  final int bytes;
}
