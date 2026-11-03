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

import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

import 'offline_models.dart';
import '../session/pending_authorization.dart';

class OfflineStore {
  OfflineStore._(this._database, this._photos);

  final Database _database;
  final Directory _photos;

  static const int schemaVersion = 3;

  /// Opens the store. `directory` lets tests use an in-memory database and a temp photo folder.
  static Future<OfflineStore> open({String? path, Directory? photoDirectory}) async {
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
            photo_path TEXT,
            photo_sha256 TEXT,
            run_id TEXT,
            model_version TEXT,
            labels_json TEXT,
            last_code TEXT,
            last_status INTEGER,
            attempts INTEGER NOT NULL DEFAULT 0
          )''');
        await db.execute('CREATE INDEX queue_subject ON queue(subject, created_at)');
        await db.execute('CREATE INDEX works_subject ON works(subject)');
        await db.execute('CREATE TABLE local_state(key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL)');
        await db.execute('CREATE TABLE auth_state(state TEXT NOT NULL PRIMARY KEY, code_verifier TEXT NOT NULL, nonce TEXT NOT NULL, redirect_url TEXT NOT NULL, created_at TEXT NOT NULL)');
      },
      onUpgrade: (db, from, to) async {
        // Version 2 remembers which subject owns the local copy so the app can reopen the prepared
        // work without a session. It is not a credential: it only scopes local rows.
        if (from < 2) {
          await db.execute('CREATE TABLE IF NOT EXISTS local_state(key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL)');
        }
        // Version 3 persists the pending PKCE state: the flow has to survive the system restarting the
        // app while the browser is in the foreground.
        if (from < 3) {
          await db.execute(
            'CREATE TABLE IF NOT EXISTS auth_state(state TEXT NOT NULL PRIMARY KEY, code_verifier TEXT NOT NULL, nonce TEXT NOT NULL, redirect_url TEXT NOT NULL, created_at TEXT NOT NULL)',
          );
        }
      },
    );
    final photos = photoDirectory ?? Directory('${(await getApplicationDocumentsDirectory()).path}/evidence');
    await photos.create(recursive: true);
    return OfflineStore._(database, photos);
  }

  Future<void> close() => _database.close();

  Directory get photoDirectory => _photos;

  // -- works prepared while online -------------------------------------------------------------
  Future<void> saveWork(PreparedWork work) async {
    await _database.insert('works', work.toRow(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<PreparedWork>> works(String subject) async {
    final rows = await _database.query('works', where: 'subject = ?', whereArgs: [subject], orderBy: 'prepared_at DESC');
    return rows.map(PreparedWork.fromRow).toList();
  }

  Future<PreparedWork?> work(String subject, String assignmentId) async {
    final rows = await _database.query('works', where: 'subject = ? AND assignment_id = ?', whereArgs: [subject, assignmentId], limit: 1);
    return rows.isEmpty ? null : PreparedWork.fromRow(rows.first);
  }

  // -- queue -----------------------------------------------------------------------------------
  Future<void> enqueue(QueuedAdvance advance) async {
    await _database.insert('queue', advance.toRow(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<QueuedAdvance>> queue(String subject, {bool onlyPending = false}) async {
    final rows = await _database.query(
      'queue',
      where: onlyPending ? 'subject = ? AND state IN (?, ?, ?)' : 'subject = ?',
      whereArgs: onlyPending ? [subject, QueueState.pending.wire, QueueState.sending.wire, QueueState.needsReupload.wire] : [subject],
      orderBy: 'created_at ASC',
    );
    return rows.map(QueuedAdvance.fromRow).toList();
  }

  Future<void> updateState(String operationId, QueueState state, {String? code, int? status, int? attempts, bool clearError = false}) async {
    await _database.update(
      'queue',
      {
        'state': state.wire,
        'last_code': clearError ? null : code,
        'last_status': clearError ? null : status,
        if (attempts != null) 'attempts': attempts,
      },
      where: 'operation_id = ?',
      whereArgs: [operationId],
    );
  }

  /// An operation left in `sending` when the app was killed is not lost and is not applied twice: it
  /// goes back to `pending` and the next push reuses its own `operationId`.
  Future<int> recoverInterrupted(String subject) async {
    final rows = await _database.query('queue', where: 'subject = ? AND state = ?', whereArgs: [subject, QueueState.sending.wire], columns: ['operation_id']);
    if (rows.isEmpty) return 0;
    await _database.update('queue', {'state': QueueState.pending.wire}, where: 'subject = ? AND state = ?', whereArgs: [subject, QueueState.sending.wire]);
    return rows.length;
  }

  Future<int> pendingCount(String subject) async {    final result = await _database.rawQuery(
      'SELECT COUNT(*) AS total FROM queue WHERE subject = ? AND state IN (?, ?, ?)',
      [subject, QueueState.pending.wire, QueueState.sending.wire, QueueState.needsReupload.wire],
    );
    return (result.first['total'] as int?) ?? 0;
  }

  /// Writes the photograph into the private directory and returns its path and SHA-256 helper-free
  /// file name. The bytes never go to the database.
  Future<File> savePhoto(String operationId, List<int> bytes, String extension) async {
    final file = File('${_photos.path}/$operationId.$extension');
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  /// Saves the pending PKCE state before the browser opens, so a restart mid-flow can still redeem the
  /// code. The verifier is not a token: it is worthless without the authorization code.
  Future<void> savePendingAuthorization(PendingAuthorization pending) async {
    await _database.insert('auth_state', pending.toRow(), conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<PendingAuthorization?> pendingAuthorization(String state) async {
    final rows = await _database.query('auth_state', where: 'state = ?', whereArgs: [state], limit: 1);
    return rows.isEmpty ? null : PendingAuthorization.fromRow(rows.first);
  }

  Future<void> clearPendingAuthorization(String state) async {
    await _database.delete('auth_state', where: 'state = ?', whereArgs: [state]);
  }

  /// Remembers which subject owns the local copy. It is only a scope, never a credential.
  Future<void> setLocalSubject(String subject) async {
    await _database.insert('local_state', {'key': 'last_subject', 'value': subject}, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<String?> localSubject() async {
    final rows = await _database.query('local_state', where: 'key = ?', whereArgs: ['last_subject'], limit: 1);
    return rows.isEmpty ? null : rows.first['value'] as String?;
  }

  /// Closing a session removes that user's prepared works and queue, keeping other users intact.
  Future<void> forget(String subject) async {
    final pending = await _database.query('queue', where: 'subject = ?', whereArgs: [subject], columns: ['photo_path']);
    for (final row in pending) {
      final path = row['photo_path'] as String?;
      if (path == null) continue;
      final file = File(path);
      if (await file.exists()) await file.delete();
    }
    await _database.delete('queue', where: 'subject = ?', whereArgs: [subject]);
    await _database.delete('works', where: 'subject = ?', whereArgs: [subject]);
  }
}
