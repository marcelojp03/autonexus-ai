/// SQLite store for the offline journey.
///
/// Rules that matter:
///  * everything is scoped by `subject`; a different account never sees another user's work or queue;
///  * the queue survives restarts because it is a table, not memory;
///  * closing the session wipes the previous user's rows (data and queue), which is what the
///    "cuenta distinta" behaviour requires;
///  * photographs live in the app's private documents directory; the database only stores the path.
library;

import 'dart:io';
import 'dart:convert';
import 'dart:math' as math;

import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

import 'offline_models.dart';
import 'vehicle_history.dart';
import '../session/pending_authorization.dart';

typedef PhotoFileWriter = Future<void> Function(File file, List<int> bytes);

class OfflineStore {
  OfflineStore._(this._database, this._photos, this._writePhoto);

  final PhotoFileWriter _writePhoto;

  final Database _database;
  final Directory _photos;

  static const int schemaVersion = 8;
  static const int maxHistoryEntries = 100;
  static const int maxHistoryBytes = 50 * 1024 * 1024;

  /// Opens the store. `directory` lets tests use an in-memory database and a temp photo folder.
  static Future<OfflineStore> open({
    String? path,
    Directory? photoDirectory,
    PhotoFileWriter? writePhoto,
  }) async {
    final database = await openDatabase(
      path ?? 'autonexus_offline.db',
      version: schemaVersion,
      onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE works(
            subject TEXT NOT NULL,
            assignment_id TEXT NOT NULL,
            order_id TEXT NOT NULL,
            order_number TEXT NOT NULL,
            version INTEGER NOT NULL,
            prepared_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            PRIMARY KEY(subject, assignment_id)
          )''');
        await db.execute('''
          CREATE TABLE queue(
            operation_id TEXT NOT NULL PRIMARY KEY,
            subject TEXT NOT NULL,
            assignment_id TEXT NOT NULL,
            base_version INTEGER NOT NULL,
            description TEXT NOT NULL,
            minutes_worked INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            state TEXT NOT NULL,
            inspection_review_json TEXT,
            photo_path TEXT,
            photo_sha256 TEXT,
            human_labels_json TEXT,
            human_reviewed_at TEXT,
            run_id TEXT,
            model_version TEXT,
            labels_json TEXT,
            last_code TEXT,
            last_status INTEGER,
            attempts INTEGER NOT NULL DEFAULT 0,
            owner_advance_id TEXT,
            evidence_id TEXT,
            evidence_attempt INTEGER NOT NULL DEFAULT 0,
            evidence_state TEXT,
            evidence_confirm_version INTEGER,
            inference_state TEXT
          )''');
        await db.execute(
          'CREATE TABLE sync_requests(operation_id TEXT NOT NULL PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES queue(operation_id) ON DELETE CASCADE, envelope TEXT NOT NULL)',
        );
        await db.execute(
          'CREATE INDEX queue_subject ON queue(subject, created_at)',
        );
        await db.execute('CREATE INDEX works_subject ON works(subject)');
        await db.execute(
          'CREATE TABLE local_state(key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL)',
        );
        await db.execute(
          'CREATE TABLE auth_state(state TEXT NOT NULL PRIMARY KEY, code_verifier TEXT NOT NULL, nonce TEXT NOT NULL, redirect_url TEXT NOT NULL, created_at TEXT NOT NULL)',
        );
        await db.execute(
          'CREATE TABLE pending_photo_capture(subject TEXT NOT NULL PRIMARY KEY, assignment_id TEXT NOT NULL, started_at TEXT NOT NULL)',
        );
        await db.execute(
          'CREATE TABLE staged_photos(subject TEXT NOT NULL, assignment_id TEXT NOT NULL, photo_path TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, content_type TEXT NOT NULL, PRIMARY KEY(subject, assignment_id))',
        );
        await _createVehicleHistoryTables(db);
      },
      onUpgrade: (db, from, to) async {
        // Version 2 remembers which subject owns the local copy so the app can reopen the prepared
        // work without a session. It is not a credential: it only scopes local rows.
        if (from < 7) {
          await db.execute(
            'ALTER TABLE queue ADD COLUMN inspection_review_json TEXT',
          );
        }
        if (from < 2) {
          await db.execute(
            'CREATE TABLE IF NOT EXISTS local_state(key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL)',
          );
        }
        // Version 3 persists the pending PKCE state: the flow has to survive the system restarting the
        // app while the browser is in the foreground.
        if (from < 3) {
          await db.execute(
            'CREATE TABLE IF NOT EXISTS auth_state(state TEXT NOT NULL PRIMARY KEY, code_verifier TEXT NOT NULL, nonce TEXT NOT NULL, redirect_url TEXT NOT NULL, created_at TEXT NOT NULL)',
          );
        }
        if (from < 4) {
          await db.execute(
            'ALTER TABLE queue ADD COLUMN human_labels_json TEXT',
          );
          await db.execute(
            'ALTER TABLE queue ADD COLUMN human_reviewed_at TEXT',
          );
          await db.execute(
            'CREATE TABLE IF NOT EXISTS pending_photo_capture(subject TEXT NOT NULL PRIMARY KEY, assignment_id TEXT NOT NULL, started_at TEXT NOT NULL)',
          );
          await db.execute(
            'CREATE TABLE IF NOT EXISTS staged_photos(subject TEXT NOT NULL, assignment_id TEXT NOT NULL, photo_path TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, content_type TEXT NOT NULL, PRIMARY KEY(subject, assignment_id))',
          );
        }
        if (from < 6) {
          await db.execute(
            'CREATE TABLE sync_requests(operation_id TEXT NOT NULL PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES queue(operation_id) ON DELETE CASCADE, envelope TEXT NOT NULL)',
          );
        }
        if (from < 8) await _createVehicleHistoryTables(db);
        if (from < 5) {
          await db.execute(
            'ALTER TABLE queue ADD COLUMN owner_advance_id TEXT',
          );
          await db.execute('ALTER TABLE queue ADD COLUMN evidence_id TEXT');
          await db.execute(
            'ALTER TABLE queue ADD COLUMN evidence_attempt INTEGER NOT NULL DEFAULT 0',
          );
          await db.execute('ALTER TABLE queue ADD COLUMN evidence_state TEXT');
          await db.execute(
            'ALTER TABLE queue ADD COLUMN evidence_confirm_version INTEGER',
          );
          await db.execute('ALTER TABLE queue ADD COLUMN inference_state TEXT');
        }
      },
    );
    final photos =
        photoDirectory ??
        Directory(
          '${(await getApplicationDocumentsDirectory()).path}/evidence',
        );
    await photos.create(recursive: true);
    return OfflineStore._(
      database,
      photos,
      writePhoto ??
          (file, bytes) async {
            await file.writeAsBytes(bytes, flush: true);
          },
    );
  }

  Future<Map<String, dynamic>?> syncRequest(String operationId) async {
    final rows = await _database.query(
      'sync_requests',
      where: 'operation_id = ?',
      whereArgs: [operationId],
    );
    return rows.isEmpty
        ? null
        : jsonDecode(rows.single['envelope'] as String) as Map<String, dynamic>;
  }

  Future<void> saveSyncRequest(
    String operationId,
    String parentId,
    Map<String, Object?> envelope,
  ) async {
    await _database.insert('sync_requests', {
      'operation_id': operationId,
      'parent_id': parentId,
      'envelope': jsonEncode(envelope),
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  Future<void> close() => _database.close();

  Directory get photoDirectory => _photos;

  static Future<void> _createVehicleHistoryTables(DatabaseExecutor db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS vehicle_histories(
        subject TEXT NOT NULL,
        vehicle_id TEXT NOT NULL,
        vehicle_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        truncated INTEGER NOT NULL CHECK(truncated IN (0,1)),
        entries_json TEXT NOT NULL,
        PRIMARY KEY(subject, vehicle_id)
      )
    ''');
    await db.execute('''
      CREATE TABLE IF NOT EXISTS vehicle_history_evidence(
        subject TEXT NOT NULL,
        vehicle_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
        created_at TEXT NOT NULL,
        local_path TEXT NOT NULL,
        PRIMARY KEY(subject, vehicle_id, order_id, evidence_id),
        FOREIGN KEY(subject, vehicle_id) REFERENCES vehicle_histories(subject, vehicle_id) ON DELETE CASCADE
      )
    ''');
    await db.execute(
      'CREATE INDEX IF NOT EXISTS vehicle_history_subject ON vehicle_histories(subject, fetched_at DESC)',
    );
  }

  Future<List<VehicleHistoryVehicle>> vehicleHistoryVehicles(
    String subject,
  ) async {
    if (subject.trim().isEmpty) throw ArgumentError.value(subject, 'subject');
    final rows = await _database.query(
      'vehicle_histories',
      columns: ['vehicle_json'],
      where: 'subject = ?',
      whereArgs: [subject],
      orderBy: 'fetched_at DESC',
    );
    return rows
        .map(
          (row) => VehicleHistoryVehicle.fromJson(
            jsonDecode(row['vehicle_json']! as String) as Map<String, dynamic>,
          ),
        )
        .toList();
  }

  Future<VehicleHistorySnapshot?> vehicleHistory(
    String subject,
    String vehicleId,
  ) async {
    if (subject.trim().isEmpty || vehicleId.trim().isEmpty)
      throw ArgumentError('Vehicle history scope is required.');
    final rows = await _database.query(
      'vehicle_histories',
      where: 'subject = ? AND vehicle_id = ?',
      whereArgs: [subject, vehicleId],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    final evidenceRows = await _database.query(
      'vehicle_history_evidence',
      columns: ['evidence_id', 'local_path'],
      where: 'subject = ? AND vehicle_id = ?',
      whereArgs: [subject, vehicleId],
    );
    final paths = {
      for (final row in evidenceRows)
        row['evidence_id']! as String: row['local_path']! as String,
    };
    for (final path in paths.values) {
      if (!await File(path).exists())
        throw const FileSystemException(
          'Una evidencia offline ya no está disponible.',
        );
    }
    final entries = jsonDecode(rows.single['entries_json']! as String) as List;
    final vehicle =
        jsonDecode(rows.single['vehicle_json']! as String)
            as Map<String, dynamic>;
    return VehicleHistorySnapshot.fromJson({
      'subject': subject,
      'vehicle': vehicle,
      'fetchedAt': rows.single['fetched_at'],
      'truncated': rows.single['truncated'] == 1,
      'entries': entries,
    }, evidencePaths: paths);
  }

  /// Writes files first, then atomically switches the SQLite snapshot. The previous snapshot and
  /// its files remain intact unless the complete replacement transaction commits.
  Future<void> replaceVehicleHistory(
    VehicleHistorySnapshot snapshot,
    Map<String, DownloadedHistoryEvidence> downloaded,
  ) async {
    if (snapshot.subject.trim().isEmpty ||
        snapshot.vehicle.id.isEmpty ||
        snapshot.entries.length > maxHistoryEntries) {
      throw const FormatException('Copia de historial inválida.');
    }
    var totalBytes = 0;
    final requiredEvidence = <VehicleHistoryEvidence>[];
    for (final entry in snapshot.entries) {
      if (entry.status != 'completed')
        throw const FormatException(
          'Solo se guardan intervenciones completadas.',
        );
      requiredEvidence.addAll(entry.evidences);
    }
    if (requiredEvidence.length != downloaded.length ||
        requiredEvidence.map((item) => item.id).toSet().length !=
            requiredEvidence.length) {
      throw const FormatException('La descarga de evidencias está incompleta.');
    }
    for (final evidence in requiredEvidence) {
      final file = downloaded[evidence.id];
      if (file == null ||
          file.contentType != evidence.contentType ||
          file.bytes.length != evidence.sizeBytes ||
          !historyEvidenceTypes.contains(file.contentType) ||
          file.bytes.isEmpty ||
          file.bytes.length > 20 * 1024 * 1024) {
        throw const FormatException(
          'Una evidencia descargada no coincide con el registro autorizado.',
        );
      }
      totalBytes += file.bytes.length;
      if (totalBytes > maxHistoryBytes)
        throw const FileSystemException('La copia offline supera 50 MiB.');
    }

    final staged = <String, String>{};
    final createdFiles = <File>[];
    var committed = false;
    try {
      var index = 0;
      for (final evidence in requiredEvidence) {
        final download = downloaded[evidence.id]!;
        final extension = switch (download.contentType) {
          'image/jpeg' => 'jpg',
          'image/png' => 'png',
          'image/webp' => 'webp',
          'video/mp4' => 'mp4',
          _ => throw const FormatException('Tipo de evidencia inválido.'),
        };
        final nonce =
            '${DateTime.now().microsecondsSinceEpoch}-${math.Random.secure().nextInt(1 << 32)}-$index';
        index++;
        final temporary = File('${_photos.path}/history-$nonce.part');
        final destination = File('${_photos.path}/history-$nonce.$extension');
        createdFiles.add(temporary);
        await _writePhoto(temporary, download.bytes);
        if (await temporary.length() != evidence.sizeBytes)
          throw const FileSystemException(
            'La evidencia local quedó incompleta.',
          );
        final committedFile = await temporary.rename(destination.path);
        createdFiles.remove(temporary);
        createdFiles.add(committedFile);
        staged[evidence.id] = committedFile.path;
      }

      final oldRows = await _database.query(
        'vehicle_history_evidence',
        columns: ['local_path'],
        where: 'subject = ? AND vehicle_id = ?',
        whereArgs: [snapshot.subject, snapshot.vehicle.id],
      );
      final oldPaths = oldRows
          .map((row) => row['local_path']! as String)
          .toList();
      await _database.transaction((txn) async {
        await txn.delete(
          'vehicle_history_evidence',
          where: 'subject = ? AND vehicle_id = ?',
          whereArgs: [snapshot.subject, snapshot.vehicle.id],
        );
        await txn.delete(
          'vehicle_histories',
          where: 'subject = ? AND vehicle_id = ?',
          whereArgs: [snapshot.subject, snapshot.vehicle.id],
        );
        await txn.insert('vehicle_histories', {
          'subject': snapshot.subject,
          'vehicle_id': snapshot.vehicle.id,
          'vehicle_json': jsonEncode(snapshot.vehicle.toJson()),
          'fetched_at': snapshot.fetchedAt.toUtc().toIso8601String(),
          'truncated': snapshot.truncated ? 1 : 0,
          'entries_json': jsonEncode(
            snapshot.entries.map((entry) => entry.toJson()).toList(),
          ),
        });
        for (final entry in snapshot.entries) {
          for (final evidence in entry.evidences) {
            await txn.insert('vehicle_history_evidence', {
              'subject': snapshot.subject,
              'vehicle_id': snapshot.vehicle.id,
              'order_id': entry.orderId,
              'evidence_id': evidence.id,
              'file_name': evidence.fileName,
              'content_type': evidence.contentType,
              'size_bytes': evidence.sizeBytes,
              'created_at': evidence.createdAt.toUtc().toIso8601String(),
              'local_path': staged[evidence.id]!,
            });
          }
        }
      });
      committed = true;
      for (final path in oldPaths) {
        final file = File(path);
        try {
          if (await file.exists()) await file.delete();
        } catch (_) {
          // The committed replacement is authoritative; a failed cleanup is only an orphaned old file.
        }
      }
    } catch (_) {
      if (!committed) {
        for (final file in createdFiles) {
          try {
            if (await file.exists()) await file.delete();
          } catch (_) {}
        }
      }
      rethrow;
    }
  }

  // -- works prepared while online -------------------------------------------------------------
  Future<void> saveWork(PreparedWork work) async {
    await _database.insert(
      'works',
      work.toRow(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<PreparedWork>> works(String subject) async {
    final rows = await _database.query(
      'works',
      where: 'subject = ?',
      whereArgs: [subject],
      orderBy: 'prepared_at DESC',
    );
    return rows.map(PreparedWork.fromRow).toList();
  }

  Future<PreparedWork?> work(String subject, String assignmentId) async {
    final rows = await _database.query(
      'works',
      where: 'subject = ? AND assignment_id = ?',
      whereArgs: [subject, assignmentId],
      limit: 1,
    );
    return rows.isEmpty ? null : PreparedWork.fromRow(rows.first);
  }

  // -- queue -----------------------------------------------------------------------------------
  Future<void> enqueue(QueuedAdvance advance) async {
    await _database.transaction((txn) async {
      await txn.insert('queue', advance.toRow());
      if (advance.photoPath != null) {
        await txn.delete(
          'staged_photos',
          where: 'subject = ? AND assignment_id = ? AND photo_path = ?',
          whereArgs: [advance.subject, advance.assignmentId, advance.photoPath],
        );
      }
    });
  }

  Future<List<QueuedAdvance>> queue(
    String subject, {
    bool onlyPending = false,
  }) async {
    final rows = await _database.query(
      'queue',
      where: onlyPending ? 'subject = ? AND state IN (?, ?, ?)' : 'subject = ?',
      whereArgs: onlyPending
          ? [
              subject,
              QueueState.pending.wire,
              QueueState.sending.wire,
              QueueState.needsReupload.wire,
            ]
          : [subject],
      orderBy: 'created_at ASC',
    );
    return rows.map(QueuedAdvance.fromRow).toList();
  }

  Future<void> updateState(
    String operationId,
    QueueState state, {
    String? code,
    int? status,
    int? attempts,
    bool clearError = false,
  }) async {
    await _database.update(
      'queue',
      {
        'state': state.wire,
        'last_code': clearError ? null : code,
        'last_status': clearError ? null : status,
        'attempts': ?attempts,
      },
      where: 'operation_id = ?',
      whereArgs: [operationId],
    );
  }

  Future<void> updateSyncProgress(
    String operationId, {
    String? ownerAdvanceId,
    String? evidenceId,
    int? evidenceAttempt,
    String? evidenceState,
    int? evidenceConfirmVersion,
    String? inferenceState,
    bool clearEvidenceConfirmVersion = false,
  }) async {
    await _database.update(
      'queue',
      {
        'owner_advance_id': ?ownerAdvanceId,
        'evidence_id': ?evidenceId,
        'evidence_attempt': ?evidenceAttempt,
        'evidence_state': ?evidenceState,
        if (clearEvidenceConfirmVersion)
          'evidence_confirm_version': null
        else
          'evidence_confirm_version': ?evidenceConfirmVersion,
        'inference_state': ?inferenceState,
      },
      where: 'operation_id = ?',
      whereArgs: [operationId],
    );
  }

  /// An operation left in `sending` when the app was killed is not lost and is not applied twice: it
  /// goes back to `pending` and the next push reuses its own `operationId`.
  Future<int> recoverInterrupted(String subject) async {
    final rows = await _database.query(
      'queue',
      where: 'subject = ? AND state = ?',
      whereArgs: [subject, QueueState.sending.wire],
      columns: ['operation_id'],
    );
    if (rows.isEmpty) return 0;
    await _database.update(
      'queue',
      {'state': QueueState.pending.wire},
      where: 'subject = ? AND state = ?',
      whereArgs: [subject, QueueState.sending.wire],
    );
    return rows.length;
  }

  Future<int> pendingCount(String subject) async {
    final result = await _database.rawQuery(
      'SELECT COUNT(*) AS total FROM queue WHERE subject = ? AND state IN (?, ?, ?)',
      [
        subject,
        QueueState.pending.wire,
        QueueState.sending.wire,
        QueueState.needsReupload.wire,
      ],
    );
    return (result.first['total'] as int?) ?? 0;
  }

  /// Writes the photograph into the private directory and returns its path and SHA-256 helper-free
  /// file name. The bytes never go to the database.
  Future<File> savePhoto(
    String operationId,
    List<int> bytes,
    String extension,
  ) async {
    final file = File('${_photos.path}/$operationId.$extension');
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  /// Persists the work scope before Android launches its external camera/gallery activity.
  Future<void> beginPhotoCapture(String subject, String assignmentId) async {
    await _database.insert('pending_photo_capture', {
      'subject': subject,
      'assignment_id': assignmentId,
      'started_at': DateTime.now().toUtc().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<({String subject, String assignmentId})?> pendingPhotoCapture() async {
    final rows = await _database.query('pending_photo_capture', limit: 1);
    if (rows.isEmpty) return null;
    return (
      subject: rows.first['subject']! as String,
      assignmentId: rows.first['assignment_id']! as String,
    );
  }

  Future<void> clearPendingPhotoCapture([String? subject]) async {
    await _database.delete(
      'pending_photo_capture',
      where: subject == null ? null : 'subject = ?',
      whereArgs: subject == null ? null : [subject],
    );
  }

  /// Copies a picked/recovered image into the application's private evidence directory.
  Future<StagedPhoto> saveStagedPhoto({
    required String subject,
    required String assignmentId,
    required List<int> bytes,
    required String sha256,
  }) async {
    final previous = await stagedPhoto(subject, assignmentId);
    final path =
        '${_photos.path}/staged-${DateTime.now().microsecondsSinceEpoch}.jpg';
    final file = File(path);
    try {
      await _writePhoto(file, bytes);
      await _database.insert('staged_photos', {
        'subject': subject,
        'assignment_id': assignmentId,
        'photo_path': path,
        'sha256': sha256,
        'bytes': bytes.length,
        'content_type': 'image/jpeg',
      }, conflictAlgorithm: ConflictAlgorithm.replace);
    } catch (_) {
      if (await file.exists()) await file.delete();
      rethrow;
    }
    if (previous != null) {
      await _deleteUnqueuedPhoto(previous.path);
    }
    return StagedPhoto(
      subject: subject,
      assignmentId: assignmentId,
      path: path,
      sha256: sha256,
      bytes: bytes.length,
    );
  }

  Future<StagedPhoto?> stagedPhoto(String subject, String assignmentId) async {
    final rows = await _database.query(
      'staged_photos',
      where: 'subject = ? AND assignment_id = ?',
      whereArgs: [subject, assignmentId],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    final row = rows.first;
    return StagedPhoto(
      subject: row['subject']! as String,
      assignmentId: row['assignment_id']! as String,
      path: row['photo_path']! as String,
      sha256: row['sha256']! as String,
      bytes: row['bytes']! as int,
    );
  }

  // Ownership moves in enqueue's transaction; never move the only file before commit.
  Future<File?> promoteStagedPhoto(
    String subject,
    String assignmentId,
    String operationId,
  ) async {
    final staged = await stagedPhoto(subject, assignmentId);
    if (staged == null) return null;
    final source = File(staged.path);
    if (!await source.exists()) {
      throw const FileSystemException(
        'La fotografía privada ya no está disponible.',
      );
    }
    return source;
  }

  Future<void> removeStagedPhoto(
    String subject,
    String assignmentId, {
    bool deleteFile = true,
  }) async {
    final staged = await stagedPhoto(subject, assignmentId);
    await _database.delete(
      'staged_photos',
      where: 'subject = ? AND assignment_id = ?',
      whereArgs: [subject, assignmentId],
    );
    if (deleteFile && staged != null) {
      await _deleteUnqueuedPhoto(staged.path);
    }
  }

  Future<void> _deleteUnqueuedPhoto(String path) async {
    final queued = await _database.query(
      'queue',
      columns: ['operation_id'],
      where: 'photo_path = ?',
      whereArgs: [path],
      limit: 1,
    );
    if (queued.isNotEmpty) return;
    final file = File(path);
    if (await file.exists()) await file.delete();
  }

  /// Saves the pending PKCE state before the browser opens, so a restart mid-flow can still redeem the
  /// code. The verifier is not a token: it is worthless without the authorization code.
  Future<void> savePendingAuthorization(PendingAuthorization pending) async {
    await _database.insert(
      'auth_state',
      pending.toRow(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<PendingAuthorization?> pendingAuthorization(String state) async {
    final rows = await _database.query(
      'auth_state',
      where: 'state = ?',
      whereArgs: [state],
      limit: 1,
    );
    return rows.isEmpty ? null : PendingAuthorization.fromRow(rows.first);
  }

  Future<void> clearPendingAuthorization(String state) async {
    await _database.delete(
      'auth_state',
      where: 'state = ?',
      whereArgs: [state],
    );
  }

  /// Remembers which subject owns the local copy. It is only a scope, never a credential.
  Future<void> setLocalSubject(String subject) async {
    await _database.insert('local_state', {
      'key': 'last_subject',
      'value': subject,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<String?> localSubject() async {
    final rows = await _database.query(
      'local_state',
      where: 'key = ?',
      whereArgs: ['last_subject'],
      limit: 1,
    );
    return rows.isEmpty ? null : rows.first['value'] as String?;
  }

  /// Closing a session removes that user's prepared works and queue, keeping other users intact.
  Future<void> forget(String subject) async {
    final pending = await _database.query(
      'queue',
      where: 'subject = ?',
      whereArgs: [subject],
      columns: ['photo_path'],
    );
    for (final row in pending) {
      final path = row['photo_path'] as String?;
      if (path == null) continue;
      final file = File(path);
      if (await file.exists()) await file.delete();
    }
    final staged = await _database.query(
      'staged_photos',
      where: 'subject = ?',
      whereArgs: [subject],
      columns: ['photo_path'],
    );
    for (final row in staged) {
      final path = row['photo_path'] as String?;
      if (path == null) continue;
      final file = File(path);
      if (await file.exists()) await file.delete();
    }
    await _database.delete('queue', where: 'subject = ?', whereArgs: [subject]);
    await _database.delete('works', where: 'subject = ?', whereArgs: [subject]);
    await _database.delete(
      'staged_photos',
      where: 'subject = ?',
      whereArgs: [subject],
    );
    await _database.delete(
      'pending_photo_capture',
      where: 'subject = ?',
      whereArgs: [subject],
    );
    final historyFiles = await _database.query(
      'vehicle_history_evidence',
      columns: ['local_path'],
      where: 'subject = ?',
      whereArgs: [subject],
    );
    await _database.transaction((txn) async {
      await txn.delete(
        'vehicle_history_evidence',
        where: 'subject = ?',
        whereArgs: [subject],
      );
      await txn.delete(
        'vehicle_histories',
        where: 'subject = ?',
        whereArgs: [subject],
      );
    });
    for (final row in historyFiles) {
      final file = File(row['local_path']! as String);
      if (await file.exists()) await file.delete();
    }
  }
}
