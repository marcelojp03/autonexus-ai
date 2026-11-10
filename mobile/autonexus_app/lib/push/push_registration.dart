import 'dart:async';
import 'dart:convert';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:http/http.dart' as http;

abstract interface class PushRegistrationPort {
  Future<void> activate(String accessToken, {bool requestPermission = false});
  Future<void> deactivate(String accessToken);
  Future<void> dispose();
}

abstract interface class FirebaseInstallationPort {
  Stream<String> get onRegistered;
  Future<bool> get permissionGranted;
  Future<void> requestPermission();
  Future<void> register();
}

class FirebaseInstallation implements FirebaseInstallationPort {
  FirebaseInstallation([FirebaseMessaging? messaging])
    : _messaging = messaging ?? FirebaseMessaging.instance;
  final FirebaseMessaging _messaging;
  @override
  Stream<String> get onRegistered => _messaging.onRegistered;
  @override
  Future<bool> get permissionGranted async {
    final status =
        (await _messaging.getNotificationSettings()).authorizationStatus;
    return status == AuthorizationStatus.authorized ||
        status == AuthorizationStatus.provisional;
  }

  @override
  Future<void> requestPermission() async {
    await _messaging.requestPermission();
  }

  @override
  Future<void> register() => _messaging.register();
}

class PushRegistration implements PushRegistrationPort {
  PushRegistration({
    required this.baseUrl,
    http.Client? client,
    FirebaseInstallationPort? messaging,
  }) : _http = client ?? http.Client(),
       _messaging = messaging ?? FirebaseInstallation();

  final String baseUrl;
  final http.Client _http;
  final FirebaseInstallationPort _messaging;
  StreamSubscription<String>? _registration;
  String? _accessToken;
  String? _fid;

  @override
  Future<void> activate(
    String accessToken, {
    bool requestPermission = false,
  }) async {
    _accessToken = accessToken;
    if (requestPermission) await _messaging.requestPermission();
    if (!await _messaging.permissionGranted) return;
    _registration ??= _messaging.onRegistered.listen((fid) {
      final previous = _fid;
      _fid = fid;
      final current = _accessToken;
      if (current != null) unawaited(_rotate(fid, previous, current));
    });
    await _messaging.register();
  }

  Future<void> _rotate(String fid, String? previous, String token) async {
    if (previous != null && previous != fid) {
      try {
        await _http
            .delete(
              Uri.parse('$baseUrl/push/installations'),
              headers: {
                'Authorization': 'Bearer $token',
                'Content-Type': 'application/json',
              },
              body: jsonEncode({'fid': previous}),
            )
            .timeout(const Duration(seconds: 3));
      } catch (_) {}
    }
    await _register(fid, token);
  }

  Future<void> _register(String fid, String token) async {
    try {
      await _http
          .post(
            Uri.parse('$baseUrl/push/installations'),
            headers: {
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              'fid': fid,
              'platform': 'android',
              'appId': 'bo.edu.uagrm.autonexus.autonexus_mobile',
            }),
          )
          .timeout(const Duration(seconds: 8));
    } catch (_) {
      // Push is optional; API/session workflows remain usable when Employees is offline.
    }
  }

  @override
  Future<void> deactivate(String accessToken) async {
    try {
      final fid = _fid ?? '';
      if (fid.isNotEmpty) {
        await _http
            .delete(
              Uri.parse('$baseUrl/push/installations'),
              headers: {
                'Authorization': 'Bearer $accessToken',
                'Content-Type': 'application/json',
              },
              body: jsonEncode({'fid': fid}),
            )
            .timeout(const Duration(seconds: 3));
      }
    } catch (_) {
      // Local logout must complete even when the registry cannot be reached.
    }
    _accessToken = null;
  }

  @override
  Future<void> dispose() async {
    await _registration?.cancel();
    _http.close();
  }
}

@pragma('vm:entry-point')
Future<void> firebaseMessageBackgroundHandler(RemoteMessage message) async {
  // The FCM notification envelope is displayed by Android. Payload data is only a navigation hint.
}
