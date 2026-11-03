/// Domain types of the offline journey.
///
/// The queue is the heart of the feature: an advance is created while there is no network, it keeps
/// its own `operationId` (the idempotency unit) and it moves through states that the UI can show
/// without inventing anything.
library;

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

  bool get isTerminal => this == QueueState.applied || this == QueueState.conflict || this == QueueState.rejected;
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
    this.photoPath,
    this.photoSha256,
    this.runId,
    this.modelVersion,
    this.labels = const {},
    this.lastCode,
    this.lastStatus,
    this.attempts = 0,
  });

  final String operationId;
  final String subject;
  final String assignmentId;
  final int baseVersion;
  final String description;
  final int minutesWorked;
  final DateTime createdAt;
  final QueueState state;

  /// Private file inside the app's documents directory; never the gallery.
  final String? photoPath;
  final String? photoSha256;
  final String? runId;
  final String? modelVersion;
  final Map<String, double> labels;
  final String? lastCode;
  final int? lastStatus;
  final int attempts;

  QueuedAdvance copyWith({QueueState? state, String? lastCode, int? lastStatus, int? attempts}) => QueuedAdvance(
        operationId: operationId,
        subject: subject,
        assignmentId: assignmentId,
        baseVersion: baseVersion,
        description: description,
        minutesWorked: minutesWorked,
        createdAt: createdAt,
        state: state ?? this.state,
        photoPath: photoPath,
        photoSha256: photoSha256,
        runId: runId,
        modelVersion: modelVersion,
        labels: labels,
        lastCode: lastCode ?? this.lastCode,
        lastStatus: lastStatus ?? this.lastStatus,
        attempts: attempts ?? this.attempts,
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
        'photo_path': photoPath,
        'photo_sha256': photoSha256,
        'run_id': runId,
        'model_version': modelVersion,
        'labels_json': labels.isEmpty ? null : _labelsToJson(labels),
        'last_code': lastCode,
        'last_status': lastStatus,
        'attempts': attempts,
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
        photoPath: row['photo_path'] as String?,
        photoSha256: row['photo_sha256'] as String?,
        runId: row['run_id'] as String?,
        modelVersion: row['model_version'] as String?,
        labels: _labelsFromJson(row['labels_json'] as String?),
        lastCode: row['last_code'] as String?,
        lastStatus: row['last_status'] as int?,
        attempts: (row['attempts'] as int?) ?? 0,
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
        if (part.contains(':')) part.split(':').first: double.parse(part.split(':').last),
    };
  }
}
