import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:autonexus_mobile/push/push_registration.dart';

class FakeInstallation implements FirebaseInstallationPort {
  final controller = StreamController<String>.broadcast();
  bool granted = true;
  int registrations = 0;
  @override
  Stream<String> get onRegistered => controller.stream;
  @override
  Future<bool> get permissionGranted async => granted;
  @override
  Future<void> requestPermission() async {
    granted = true;
  }

  @override
  Future<void> register() async {
    registrations++;
  }
}

void main() {
  test('registers initial and refreshed FIDs under the active bearer without echo payload', () async {
    final installation = FakeInstallation();
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response('', 200);
    });
    final service = PushRegistration(
      baseUrl: 'https://employees.invalid',
      client: client,
      messaging: installation,
    );
    await service.activate('access-a', requestPermission: true);
    installation.controller.add('fid-one-012345678901234');
    await Future<void>.delayed(Duration.zero);
    installation.controller.add('fid-two-012345678901234');
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(installation.registrations, 2);
    expect(requests.map((r) => r.method), ['POST', 'DELETE', 'POST']);
    expect(requests.first.headers['Authorization'], 'Bearer access-a');
    expect(jsonDecode(requests.first.body), {
      'fid': 'fid-one-012345678901234',
      'platform': 'android',
      'appId': 'bo.edu.uagrm.autonexus.autonexus_mobile',
    });
    expect(requests.last.body, contains('fid-two-012345678901234'));
    await service.dispose();
    await installation.controller.close();
  });

  test('logout association removal is best effort and scoped to the last current FID', () async {
    final installation = FakeInstallation();
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response('', 503);
    });
    final service = PushRegistration(
      baseUrl: 'https://employees.invalid',
      client: client,
      messaging: installation,
    );
    await service.activate('access-a', requestPermission: true);
    installation.controller.add('fid-one-012345678901234');
    await Future<void>.delayed(Duration.zero);
    await service.deactivate('access-a');
    expect(requests.last.method, 'DELETE');
    expect(jsonDecode(requests.last.body), {'fid': 'fid-one-012345678901234'});
    await service.dispose();
    await installation.controller.close();
  });
}
