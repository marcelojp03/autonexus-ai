import 'package:autonexus_mobile/api/owner_api.dart';
import 'package:autonexus_mobile/app/journey_controller.dart';
import 'package:autonexus_mobile/app/journey_home.dart';
import 'package:autonexus_mobile/app/work_page.dart';
import 'package:autonexus_mobile/offline/offline_models.dart';
import 'package:autonexus_mobile/offline/offline_store.dart';
import 'package:autonexus_mobile/offline/sync_service.dart';
import 'package:autonexus_mobile/session/keycloak_session.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

void main() {
  setUp(() => dotenv.loadFromString(envString: 'AUTONEXUS_PREPARATION_DAYS=7'));
  for (final scenario in ['completed', 'unknown', 'assignment', 'account', 'valid']) {
    test('prepare revalidates owner and preserves prior copy: $scenario', () async {
      final store = _Store();
      final session = _Session(store);
      final api = _Api(() {
        if (scenario == 'account') session.subject = 'other';
        return ExecutionSnapshot(assignmentId: scenario == 'assignment' ? 'other' : 'a',
          orderId: 'o', orderNumber: 'WO-1', status: ['completed', 'unknown'].contains(scenario)
            ? scenario : 'in_progress', version: 2, advances: 0);
      });
      final controller = JourneyController(session: session, store: store, api: api,
        sync: SyncService(baseUrl: '', store: store));
      await controller.prepare(const AgendaWorkItem(assignmentId: 'a', orderId: 'o',
        orderNumber: 'WO-1', description: '', vehiclePlate: '',
        executionStatus: 'in_progress', advances: 0, startsAt: ''));
      expect(store.saves, scenario == 'valid' ? 1 : 0);
      if (scenario != 'valid') expect(controller.lastError, isNotNull);
      controller.dispose();
    });
  }
  test('missing owner status never authorizes preparation', () {
    expect(ExecutionSnapshot.fromJson({
      'assignmentId': 'a', 'orderId': 'o', 'orderNumber': 'WO-1',
    }).status, isNot('in_progress'));
  });
  testWidgets('form starts empty and focuses first invalid input', (tester) async {
    tester.view.physicalSize = const Size(1000, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    final controller = _controller();
    await tester.pumpWidget(MaterialApp(home: WorkPage(
      controller: controller,
      work: PreparedWork(subject: 'operator', assignmentId: 'a', orderId: 'o',
        orderNumber: 'WO-1', version: 1, preparedAt: DateTime.utc(2026),
        expiresAt: DateTime.utc(2030)),
    )));
    final description = find.byKey(const Key('advance-description'));
    final minutes = find.byKey(const Key('advance-minutes'));
    expect(tester.widget<TextField>(description).controller!.text, isEmpty);
    expect(tester.widget<TextField>(minutes).controller!.text, isEmpty);
    await tester.ensureVisible(find.byKey(const Key('save-advance')));
    await tester.tap(find.byKey(const Key('save-advance')));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(description).decoration!.errorText, isNotNull);
    expect(tester.widget<TextField>(description).focusNode!.hasFocus, isTrue);
    await tester.enterText(description, 'Trabajo deliberado');
    await tester.ensureVisible(find.byKey(const Key('save-advance')));
    await tester.tap(find.byKey(const Key('save-advance')));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(minutes).decoration!.errorText, isNotNull);
    expect(tester.widget<TextField>(minutes).focusNode!.hasFocus, isTrue);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });
  for (final status in ['not_started', 'in_progress', 'completed', 'unknown']) {
    testWidgets('agenda preparation gate: $status', (tester) async {
      final controller = _controller();
      controller.available = [AgendaWorkItem(assignmentId: 'a', orderId: 'o',
        orderNumber: 'WO-1', description: 'Servicio', vehiclePlate: 'TEST',
        executionStatus: status, advances: 0, startsAt: '')];
      await tester.pumpWidget(MaterialApp(home: JourneyHome(controller: controller)));
      final button = tester.widget<TextButton>(find.byKey(const Key('prepare-a')));
      expect(button.onPressed != null, status == 'in_progress');
      expect(find.textContaining('ejecución $status'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      controller.dispose();
    });
  }
}
JourneyController _controller() {
  final store = _Store();
  return JourneyController(session: _Session(store), store: store,
    api: OwnerApi(baseUrl: ''), sync: SyncService(baseUrl: '', store: store));
}
class _Store implements OfflineStore {
  int saves = 0;
  @override
  Future<void> saveWork(PreparedWork work) async { saves++; }
  @override
  Future<String?> localSubject() async => 'operator';
  @override
  Future<int> recoverInterrupted(String subject) async => 0;
  @override
  Future<List<PreparedWork>> works(String subject) async => [];
  @override
  Future<List<QueuedAdvance>> queue(String subject, {bool onlyPending = false}) async => [];
  @override
  Future<StagedPhoto?> stagedPhoto(String subject, String assignmentId) async => null;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
class _Session extends KeycloakSession {
  String subject = 'operator';
  _Session(OfflineStore store) : super(issuer: '', clientId: '', redirectUrl: '',
    store: store, launchBrowser: (_) async => false);
  @override
  SessionSnapshot get snapshot => SessionSnapshot(authenticated: true, subject: subject);
  @override
  Future<String?> accessToken({Duration margin = const Duration(seconds: 15)}) async => 'token';
}

class _Api extends OwnerApi {
  _Api(this.result) : super(baseUrl: '');
  final ExecutionSnapshot Function() result;
  @override
  Future<ExecutionSnapshot> execution(String token, String assignmentId) async => result();
}
