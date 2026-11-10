import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:autonexus_mobile/api/owner_api.dart';
import 'package:autonexus_mobile/app/journey_controller.dart';
import 'package:autonexus_mobile/app/journey_home.dart';
import 'package:autonexus_mobile/offline/offline_models.dart';
import 'package:autonexus_mobile/offline/offline_store.dart';
import 'package:autonexus_mobile/offline/sync_service.dart';
import 'package:autonexus_mobile/offline/vehicle_history.dart';
import 'package:autonexus_mobile/session/keycloak_session.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory temp;
  late OfflineStore store;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('cu08-history-');
    store = await OfflineStore.open(
      path: '${temp.path}/offline.db',
      photoDirectory: Directory('${temp.path}/private'),
    );
  });

  tearDown(() async {
    await store.close();
    if (await temp.exists()) await temp.delete(recursive: true);
  });

  testWidgets(
    'offline picker opens only a saved snapshot and labels it stale',
    (tester) async {
      await store.setLocalSubject('actor-a');
      await store.replaceVehicleHistory(_snapshot('actor-a'), const {});
      final session = _Session(store, SessionSnapshot.signedOut);
      final controller = _controller(store, session, _Api());
      await controller.load();
      await tester.pumpWidget(
        MaterialApp(home: JourneyHome(controller: controller)),
      );
      await tester.tap(find.byKey(const Key('vehicle-history-entry')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('history-vehicle-search')),
        'ABC',
      );
      await tester.tap(find.byKey(const Key('history-vehicle-search-submit')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('history-vehicle-vehicle-1')),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('history-vehicle-vehicle-1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('history-stale-state')), findsOneWidget);
      expect(find.textContaining('Puede estar desactualizada'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('history-download-offline')),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byKey(const Key('history-order-order-1')));
      await tester.pumpAndSettle();
      expect(find.text('Servicio anotado'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      controller.dispose();
    },
  );

  test(
    'online download stores only authorized bytes and reopens the subject-scoped snapshot',
    () async {
      await store.setLocalSubject('actor-a');
      final session = _Session(
        store,
        const SessionSnapshot(authenticated: true, subject: 'actor-a'),
        token: 'ram-token',
      );
      final api = _Api(withEvidence: true);
      final controller = _controller(store, session, api);
      final saved = await controller.downloadHistoryForOffline(_vehicle());
      expect(saved, isTrue);
      expect(api.downloaded, ['evidence-1']);
      expect(api.tokens, ['ram-token', 'ram-token']);
      final reopened = (await store.vehicleHistory('actor-a', 'vehicle-1'))!;
      final file = File(reopened.entries.single.evidences.single.localPath!);
      expect(await file.readAsBytes(), [11, 12, 13]);
      expect(await store.vehicleHistory('actor-b', 'vehicle-1'), isNull);
      expect(jsonEncode(reopened.toJson()), isNot(contains('ram-token')));
      controller.dispose();
    },
  );

  test(
    'partial download or account switch never replaces the previous snapshot',
    () async {
      await store.setLocalSubject('actor-a');
      final previous = _snapshot('actor-a', orderId: 'previous-order');
      await store.replaceVehicleHistory(previous, const {});
      final session = _Session(
        store,
        const SessionSnapshot(authenticated: true, subject: 'actor-a'),
        token: 'ram-token',
      );
      final api = _Api(
        withEvidence: true,
        onEvidence: () {
          session.value = SessionSnapshot.signedOut;
        },
      );
      final controller = _controller(store, session, api);
      expect(await controller.downloadHistoryForOffline(_vehicle()), isFalse);
      expect(
        (await store.vehicleHistory(
          'actor-a',
          'vehicle-1',
        ))!.entries.single.orderId,
        'previous-order',
      );
      controller.dispose();
    },
  );
}

JourneyController _controller(
  OfflineStore store,
  _Session session,
  OwnerApi api,
) => JourneyController(
  session: session,
  store: store,
  api: api,
  sync: SyncService(baseUrl: '', store: store),
);

VehicleHistoryVehicle _vehicle() => const VehicleHistoryVehicle(
  id: 'vehicle-1',
  plate: 'ABC-123',
  make: 'Toyota',
  model: 'Yaris',
  year: 2022,
);

VehicleHistorySnapshot _snapshot(
  String subject, {
  String orderId = 'order-1',
}) => VehicleHistorySnapshot(
  subject: subject,
  vehicle: _vehicle(),
  fetchedAt: DateTime.utc(2026, 11, 9),
  truncated: false,
  entries: [
    VehicleServiceHistoryEntry(
      orderId: orderId,
      orderNumber: 'WO-1',
      servicedAt: DateTime.utc(2026, 11, 8),
      type: 'mantenimiento',
      status: 'completed',
      description: 'Servicio anotado',
      observations: 'Filtro cambiado',
      receptionReason: 'Rutina',
      symptoms: null,
      services: const [
        VehicleHistoryService(
          id: 'service-1',
          recordedName: 'Servicio',
          quantity: 1,
          minutes: 30,
        ),
      ],
      evidences: const [],
    ),
  ],
);

class _Session extends KeycloakSession {
  _Session(OfflineStore store, this.value, {this.token})
    : super(
        issuer: '',
        clientId: '',
        redirectUrl: '',
        store: store,
        launchBrowser: (_) async => false,
      );
  SessionSnapshot value;
  String? token;
  @override
  SessionSnapshot get snapshot => value;
  @override
  Future<String?> accessToken({
    Duration margin = const Duration(seconds: 15),
  }) async => token;
}

class _Api extends OwnerApi {
  _Api({this.withEvidence = false, this.onEvidence})
    : super(baseUrl: 'http://owner');
  final bool withEvidence;
  final void Function()? onEvidence;
  final List<String> downloaded = [];
  final List<String> tokens = [];

  @override
  Future<List<VehicleHistoryVehicle>> findHistoryVehicles(
    String token,
    String search,
  ) async {
    tokens.add(token);
    return [_vehicle()];
  }

  @override
  Future<VehicleHistoryPage> vehicleServiceHistory(
    String token,
    String vehicleId, {
    int limit = 100,
    int offset = 0,
  }) async {
    tokens.add(token);
    final base = _snapshot('actor-a').entries.single;
    final entries = withEvidence
        ? [
            VehicleServiceHistoryEntry(
              orderId: base.orderId,
              orderNumber: base.orderNumber,
              servicedAt: base.servicedAt,
              type: base.type,
              status: base.status,
              description: base.description,
              observations: base.observations,
              receptionReason: base.receptionReason,
              symptoms: base.symptoms,
              services: base.services,
              evidences: [
                VehicleHistoryEvidence(
                  id: 'evidence-1',
                  fileName: 'photo.png',
                  contentType: 'image/png',
                  sizeBytes: 3,
                  createdAt: DateTime.utc(2026, 11, 8),
                ),
              ],
            ),
          ]
        : [base];
    return VehicleHistoryPage(entries: entries, truncated: false);
  }

  @override
  Future<DownloadedHistoryEvidence> downloadHistoryEvidence(
    String token,
    String vehicleId,
    String orderId,
    VehicleHistoryEvidence evidence,
  ) async {
    onEvidence?.call();
    tokens.add(token);
    downloaded.add(evidence.id);
    return DownloadedHistoryEvidence(
      fileName: evidence.fileName,
      contentType: evidence.contentType,
      bytes: Uint8List.fromList([11, 12, 13]),
    );
  }
}
