/// State of the offline journey, shared by the screens.
///
/// Two planes are kept apart on purpose:
///  * the **local** plane (SQLite + private files) works without network and is scoped by subject;
///  * the **session** plane (Keycloak, in memory) decides whether a write can be authorised *now*.
///
/// Working on the prepared copy is allowed without a valid session; syncing is not. That is why the
/// controller never treats "offline" as an error and never shows a queued advance as accepted.
library;

import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../api/owner_api.dart';
import '../config.dart';
import '../offline/offline_models.dart';
import '../offline/offline_store.dart';
import '../offline/vehicle_history.dart';
import '../offline/sync_service.dart';
import '../session/keycloak_session.dart';
import '../evidence/photo_capture.dart';
import '../push/push_registration.dart';

class JourneyController extends ChangeNotifier {
  JourneyController({
    required this.session,
    required this.store,
    required this.api,
    required this.sync,
    PhotoCapturePort? photoCapture,
    this.pushRegistration,
  }) : photoCapture = photoCapture ?? MobilePhotoCapture();

  final KeycloakSession session;
  final OfflineStore store;
  final OwnerApi api;
  final SyncService sync;
  final PhotoCapturePort photoCapture;
  final PushRegistrationPort? pushRegistration;

  SessionSnapshot get snapshot => session.snapshot;

  List<PreparedWork> works = const [];
  List<QueuedAdvance> queue = const [];
  List<AgendaWorkItem>? available;
  DateTime agendaDay = DateTime.now();
  String? notice;
  String? lastError;
  bool busy = false;
  List<VehicleHistoryVehicle> historyVehicles = const [];
  VehicleHistorySnapshot? openHistory;
  bool historyOffline = false;
  String? historyError;

  /// Count of operations that were interrupted while `sending` and went back to `pending`.
  int recovered = 0;

  /// Subject that owns the local copy. With no session this is what lets the operator consult the
  /// prepared work offline; it is a scope, never a credential.
  String? localSubject;

  final Map<String, ({String description, String minutes})> _advanceDrafts = {};
  String? _previousAccountPushToken;

  String _draftKey(PreparedWork work) =>
      '${work.subject.length}:${work.subject}${work.assignmentId}';

  ({String description, String minutes})? advanceDraft(PreparedWork work) =>
      _advanceDrafts[_draftKey(work)];

  void saveAdvanceDraft(
    PreparedWork work, {
    required String description,
    required String minutes,
  }) {
    _advanceDrafts[_draftKey(work)] = (
      description: description,
      minutes: minutes,
    );
  }

  void clearAdvanceDraft(PreparedWork work) =>
      _advanceDrafts.remove(_draftKey(work));

  Future<void> load() async {
    localSubject = await store.localSubject();
    final subject = snapshot.subject ?? localSubject;
    if (subject == null) {
      works = const [];
      queue = const [];
      notifyListeners();
      return;
    }
    recovered = await store.recoverInterrupted(subject);
    works = await store.works(subject);
    queue = await store.queue(subject);
    notifyListeners();
  }

  Future<void> signIn() async {
    await _run(() async {
      final existingToken = await session.accessToken();
      _previousAccountPushToken = existingToken;
      final result = await session.signIn();
      if (result.error != null) {
        _previousAccountPushToken = null;
        lastError = result.error;
        return;
      }
      notice = 'Completá el inicio de sesión en el navegador.';
    });
    await load();
  }

  /// Finishes the flow when the browser returns the authorization response, including when the system
  /// restarted the app while the browser was in the foreground.
  Future<void> handleCallback(Uri callback) async {
    if (!callback.toString().startsWith(AppConfig.redirectUrl)) return;
    await _run(() async {
      final result = await session.completeAuthorization(callback);
      if (!result.authenticated) {
        _previousAccountPushToken = null;
        lastError = result.error ?? 'No se pudo completar el inicio de sesión.';
        return;
      }
      await _adoptSession(result);
    });
    await load();
  }

  Future<void> _adoptSession(SessionSnapshot result) async {
    final subject = result.subject;
    if (subject == null) {
      lastError = 'El token no identifica al usuario.';
      return;
    }
    final previous = await store.localSubject();
    if (previous != null && previous != subject) {
      final previousToken = _previousAccountPushToken;
      if (previousToken != null) {
        await pushRegistration?.deactivate(previousToken);
      }
      // Another account signed in on this device: its prepared works and queue are wiped, as the
      // offline design requires, so nobody reads or sends work that is not theirs.
      await store.forget(previous);
    }
    await store.setLocalSubject(subject);
    _previousAccountPushToken = null;
    final accessToken = await session.accessToken();
    if (accessToken != null) await pushRegistration?.activate(accessToken);
    notice = 'Sesión iniciada como ${result.name ?? subject}.';
  }

  Future<void> signOut() async {
    await _run(() async {
      final subject = snapshot.subject ?? localSubject;
      final token = await session.accessToken();
      if (token != null) await pushRegistration?.deactivate(token);
      await session.signOut();
      if (subject != null) await store.forget(subject);
      available = null;
      notice = 'Sesión cerrada; la copia local se descartó.';
    });
    await load();
  }

  Future<void> findHistoryVehicles(String search) async {
    final boundedSearch = search.trim();
    if (boundedSearch.length < 2 || boundedSearch.length > 100) {
      historyError = 'Ingresá entre dos y cien caracteres para buscar.';
      notifyListeners();
      return;
    }
    historyError = null;
    await _run(() async {
      final subject = snapshot.subject ?? localSubject;
      if (subject == null) {
        historyVehicles = const [];
        historyError = 'Iniciá sesión para buscar vehículos.';
        return;
      }
      if (!snapshot.authenticated) {
        final cached = await store.vehicleHistoryVehicles(subject);
        final term = boundedSearch.toLowerCase();
        historyVehicles = cached
            .where(
              (vehicle) =>
                  vehicle.plate.toLowerCase().contains(term) ||
                  vehicle.make.toLowerCase().contains(term) ||
                  vehicle.model.toLowerCase().contains(term),
            )
            .toList();
        historyError = historyVehicles.isEmpty
            ? 'Sin conexión: no hay coincidencias descargadas previamente.'
            : null;
        notifyListeners();
        return;
      }
      final token = await _token();
      if (token == null) return;
      late final List<VehicleHistoryVehicle> found;
      try {
        found = await api.findHistoryVehicles(token, boundedSearch);
      } on OwnerFailure catch (error) {
        if (error.status != 0 && error.status != 503) rethrow;
        final cached = await store.vehicleHistoryVehicles(subject);
        final term = boundedSearch.toLowerCase();
        found = cached
            .where(
              (vehicle) =>
                  vehicle.plate.toLowerCase().contains(term) ||
                  vehicle.make.toLowerCase().contains(term) ||
                  vehicle.model.toLowerCase().contains(term),
            )
            .toList();
        historyOffline = true;
        historyError = found.isEmpty
            ? 'Sin conexión: no hay coincidencias descargadas previamente.'
            : null;
        historyVehicles = found;
        notifyListeners();
        return;
      }
      if (!snapshot.authenticated || snapshot.subject != subject)
        throw const OwnerFailure(
          401,
          'UNAUTHENTICATED',
          'La cuenta cambió durante la búsqueda.',
        );
      historyVehicles = found;
      historyOffline = false;
      historyError = found.isEmpty
          ? 'No se encontraron vehículos activos con ese texto.'
          : null;
      notifyListeners();
    });
    if (historyError == null && lastError != null) historyError = lastError;
    notifyListeners();
  }

  Future<VehicleHistorySnapshot?> loadVehicleHistory(
    VehicleHistoryVehicle vehicle,
  ) async {
    VehicleHistorySnapshot? result;
    historyError = null;
    await _run(() async {
      final subject = snapshot.subject ?? localSubject;
      if (subject == null)
        throw const OwnerFailure(
          401,
          'UNAUTHENTICATED',
          'La sesión no identifica la copia local.',
        );
      if (!snapshot.authenticated) {
        result = await store.vehicleHistory(subject, vehicle.id);
        if (result == null)
          throw const OwnerFailure(
            404,
            'SERVICE_HISTORY_NOT_DOWNLOADED',
            'Este historial no se descargó para usar offline.',
          );
        historyOffline = true;
      } else {
        final token = await _token();
        if (token == null) return;
        try {
          final page = await api.vehicleServiceHistory(token, vehicle.id);
          if (!snapshot.authenticated || snapshot.subject != subject)
            throw const OwnerFailure(
              401,
              'UNAUTHENTICATED',
              'La cuenta cambió durante la consulta.',
            );
          result = VehicleHistorySnapshot(
            subject: subject,
            vehicle: vehicle,
            fetchedAt: DateTime.now().toUtc(),
            truncated: page.truncated,
            entries: page.entries,
          );
          historyOffline = false;
        } on OwnerFailure catch (error) {
          if (error.status != 0 && error.status != 503) rethrow;
          result = await store.vehicleHistory(subject, vehicle.id);
          if (result == null) rethrow;
          historyOffline = true;
        }
      }
      openHistory = result;
      historyError = null;
      notifyListeners();
    });
    if (result == null && lastError != null) historyError = lastError;
    notifyListeners();
    return result;
  }

  Future<bool> downloadHistoryForOffline(VehicleHistoryVehicle vehicle) async {
    var saved = false;
    await _run(() async {
      final subject = snapshot.subject;
      if (!snapshot.authenticated || subject == null)
        throw const OwnerFailure(
          401,
          'UNAUTHENTICATED',
          'Iniciá sesión para descargar el historial.',
        );
      final token = await _token();
      if (token == null) return;
      final page = await api.vehicleServiceHistory(token, vehicle.id);
      final files = <String, DownloadedHistoryEvidence>{};
      var downloadedBytes = 0;
      for (final entry in page.entries) {
        for (final evidence in entry.evidences) {
          downloadedBytes += evidence.sizeBytes;
          if (downloadedBytes > OfflineStore.maxHistoryBytes)
            throw const FileSystemException('La copia offline supera 50 MiB.');
          final file = await api.downloadHistoryEvidence(
            token,
            vehicle.id,
            entry.orderId,
            evidence,
          );
          if (!snapshot.authenticated || snapshot.subject != subject)
            throw const OwnerFailure(
              401,
              'UNAUTHENTICATED',
              'La cuenta cambió durante la descarga.',
            );
          files[evidence.id] = file;
        }
      }
      if (!snapshot.authenticated || snapshot.subject != subject)
        throw const OwnerFailure(
          401,
          'UNAUTHENTICATED',
          'La cuenta cambió antes de guardar la copia.',
        );
      final complete = VehicleHistorySnapshot(
        subject: subject,
        vehicle: vehicle,
        fetchedAt: DateTime.now().toUtc(),
        truncated: page.truncated,
        entries: page.entries,
      );
      await store.replaceVehicleHistory(complete, files);
      if (!snapshot.authenticated || snapshot.subject != subject) {
        await store.forget(subject);
        throw const OwnerFailure(
          401,
          'UNAUTHENTICATED',
          'La cuenta cambió mientras se guardaba la copia.',
        );
      }
      openHistory = await store.vehicleHistory(subject, vehicle.id);
      historyOffline = false;
      historyError = null;
      saved = true;
      notifyListeners();
    });
    if (!saved && lastError != null) historyError = lastError;
    notifyListeners();
    return saved;
  }

  /// Downloads the authorised work of the signed-in employee and prepares the one chosen.
  Future<void> fetchAvailable() async {
    await _run(() async {
      final token = await _token();
      if (token == null) return;
      available = await api.myAgenda(token, day: agendaDay);
      notice = available!.isEmpty
          ? 'No hay trabajos asignados para el día elegido.'
          : '${available!.length} trabajo(s) autorizado(s).';
    });
  }

  Future<void> enableNotifications() async {
    final token = await _token();
    if (token == null) return;
    await pushRegistration?.activate(token, requestPermission: true);
    notice = 'Los avisos de trabajos asignados quedaron habilitados en este dispositivo.';
    notifyListeners();
  }

  /// A push only selects a candidate; the agenda API reauthorizes ownership before the UI opens it.
  Future<void> handleAssignmentNotification(Map<String, dynamic> data) async {
    if (data['eventKind'] != 'cu15.assignment.confirmed' ||
        data['assignmentId'] is! String ||
        !snapshot.authenticated)
      return;
    await fetchAvailable();
    if (available?.any((item) => item.assignmentId == data['assignmentId']) !=
        true) {
      notice = 'La asignación ya no está disponible en tu agenda.';
      notifyListeners();
    }
  }

  Future<void> chooseAgendaDay(DateTime day) async {
    agendaDay = DateTime(day.year, day.month, day.day);
    available = null;
    notifyListeners();
    await fetchAvailable();
  }

  Future<void> prepare(AgendaWorkItem item) async {
    if (busy) return;
    await _run(() async {
      if (!item.canReceiveAdvances) {
        lastError =
            'Este trabajo no está en ejecución y no admite nuevos avances.';
        return;
      }
      final token = await _token();
      if (token == null) return;
      final subject = snapshot.subject!;
      final execution = await api.execution(token, item.assignmentId);
      if (snapshot.subject != subject || !snapshot.authenticated) {
        lastError = 'La cuenta cambió. Volvé a descargar tus trabajos.';
        return;
      }
      if (execution.assignmentId != item.assignmentId ||
          execution.orderId != item.orderId) {
        lastError = 'La asignación cambió. Volvé a descargar tus trabajos.';
        return;
      }
      if (execution.status != 'in_progress') {
        lastError = 'El trabajo ya no está en ejecución. Se conservan la copia local y los avances pendientes.';
        return;
      }
      final now = DateTime.now().toUtc();
      await store.saveWork(
        PreparedWork(
          subject: subject,
          assignmentId: item.assignmentId,
          orderId: execution.orderId,
          orderNumber: execution.orderNumber,
          version: execution.version,
          preparedAt: now,
          expiresAt: now.add(Duration(days: AppConfig.preparationDays)),
        ),
      );
      notice =
          'Trabajo ${execution.orderNumber} preparado para usar sin conexión.';
    });
    await load();
  }

  Future<StagedPhoto?> capturePhoto(
    PreparedWork work,
    PhotoSource source,
  ) async {
    await store.beginPhotoCapture(work.subject, work.assignmentId);
    try {
      final raw = await photoCapture.pick(source);
      if (raw == null) return null;
      final prepared = PhotoProcessor.prepare(raw);
      return await store.saveStagedPhoto(
        subject: work.subject,
        assignmentId: work.assignmentId,
        bytes: prepared.bytes,
        sha256: prepared.sha256,
      );
    } finally {
      await store.clearPendingPhotoCapture(work.subject);
    }
  }

  Future<StagedPhoto?> stagedPhoto(PreparedWork work) =>
      store.stagedPhoto(work.subject, work.assignmentId);

  Future<void> removeStagedPhoto(PreparedWork work) =>
      store.removeStagedPhoto(work.subject, work.assignmentId);

  /// Saves an advance in the local queue. It works with or without session: the operator is working on
  /// the prepared copy and the server has not seen anything yet.
  Future<QueuedAdvance?> queueAdvance({
    required PreparedWork work,
    required String description,
    required int minutes,
    StagedPhoto? photo,
    InspectionReview? inspectionReview,
    String? runId,
    String? modelVersion,
    Map<String, double> labels = const {},
    List<String>? humanReviewLabels,
    DateTime? humanReviewedAt,
  }) async {
    QueuedAdvance? created;
    if (busy) return null;
    await _run(() async {
      final subject = snapshot.subject ?? localSubject;
      if (subject == null || subject != work.subject) {
        lastError = 'La copia local pertenece a otra cuenta.';
        return;
      }
      if (photo != null &&
          (photo.subject != subject ||
              photo.assignmentId != work.assignmentId)) {
        lastError = 'La fotografía pertenece a otro trabajo o cuenta.';
        return;
      }
      final ownerDescription =
          inspectionReview?.ownerDescription ?? description;
      if (ownerDescription.trim().length < 3 ||
          ownerDescription.length > 2000) {
        lastError = 'La descripción necesita entre 3 y 2000 caracteres.';
        return;
      }
      final operationId = _uuid();
      final privatePhoto = photo == null
          ? null
          : await store.promoteStagedPhoto(
              subject,
              work.assignmentId,
              operationId,
            );
      if (photo != null && privatePhoto == null) {
        lastError = 'La fotografía privada ya no está disponible.';
        return;
      }
      final candidate = QueuedAdvance(
        operationId: operationId,
        subject: subject,
        assignmentId: work.assignmentId,
        baseVersion: work.version,
        description: ownerDescription,
        inspectionReview: inspectionReview,
        minutesWorked: minutes,
        createdAt: DateTime.now().toUtc(),
        state: QueueState.pending,
        photoPath: privatePhoto?.path,
        photoSha256: photo?.sha256,
        humanReviewLabels: humanReviewLabels,
        humanReviewedAt: humanReviewedAt,
        runId: runId,
        modelVersion: modelVersion,
        labels: labels,
      );
      await store.enqueue(candidate);
      created = candidate;
      clearAdvanceDraft(work);
      notice =
          'Avance guardado como pendiente. Todavía no está en el servidor.';
    });
    try {
      await load();
    } catch (_) {
      lastError = 'No se pudo actualizar la lista local. Conservá el borrador si no se confirmó el guardado.';
      notifyListeners();
    }
    return created;
  }

  /// Pushes the pending queue through MS05 with a valid session. A lost response or an expired token
  /// leaves the operation pending with the same `operationId`.
  Future<void> syncNow() async {
    await _run(() async {
      final token = await _token();
      if (token == null) return;
      final subject = snapshot.subject!;
      final outcome = await sync.pushPending(subject: subject, token: token);
      if (outcome.error != null) {
        lastError =
            'No se pudo sincronizar (${outcome.error}); el avance sigue pendiente.';
      } else if (outcome.applied.isNotEmpty) {
        notice =
            '${outcome.applied.length} avance(s) confirmados por el servidor.';
      } else if (outcome.failed.isNotEmpty) {
        final first = outcome.failed.first;
        notice =
            'El servidor respondió ${first.state} (${first.code ?? 'sin código'}).';
      } else {
        notice = 'Nada pendiente de sincronizar.';
      }
    });
    await load();
  }

  /// Current access token, renewing it when needed. Returns `null` when the session is gone, which
  /// the UI shows as "volvé a iniciar sesión" instead of retrying forever.
  Future<String?> _token() async {
    final token = await session.accessToken();
    if (token == null) {
      lastError =
          'La sesión no está vigente. Volvé a iniciar sesión para sincronizar.';
    }
    return token;
  }

  Future<void> _run(Future<void> Function() action) async {
    busy = true;
    lastError = null;
    notifyListeners();
    try {
      await action();
    } on OwnerFailure catch (error) {
      lastError = error.isUnauthenticated
          ? 'La sesión no está vigente.'
          : error.label;
    } catch (error) {
      lastError = 'No se pudo completar: $error';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  String _uuid() {
    final random = math.Random.secure();
    final values = List<int>.generate(16, (_) => random.nextInt(256));
    values[6] = (values[6] & 0x0f) | 0x40;
    values[8] = (values[8] & 0x3f) | 0x80;
    final hex = values
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
