import 'dart:convert';
import 'dart:io';

import 'package:autonexus_mobile/offline/offline_store.dart';
import 'package:autonexus_mobile/session/keycloak_session.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// The pending state has to survive a process restart: on this platform the system can kill the app
/// while the browser is in the foreground. These tests use one store and two session instances to
/// model exactly that, plus a fake transport that records what the exchange sends.
void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory temp;
  late OfflineStore store;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('autonexus-session');
    store = await OfflineStore.open(path: '${temp.path}/session.db', photoDirectory: Directory('${temp.path}/evidence'));
  });

  tearDown(() async {
    await store.close();
    await temp.delete(recursive: true);
  });

  KeycloakSession buildSession({required Uri? launched, required Map<String, String> tokenBody}) {
    final client = _FakeClient(tokenBody);
    return KeycloakSession(
      issuer: 'http://127.0.0.1:4285/identity/realms/autonexus',
      clientId: 'autonexus-mobile',
      redirectUrl: 'bo.edu.uagrm.autonexus://auth/callback',
      store: store,
      launchBrowser: (url) async {
        expect(url.queryParameters['code_challenge_method'], 'S256');
        expect(url.queryParameters['client_id'], 'autonexus-mobile');
        expect(url.queryParameters['response_type'], 'code');
        launched = url;
        return true;
      },
      httpClient: client,
    );
  }

  test('the pending state is persisted before the browser opens', () async {
    Uri? launched;
    final session = buildSession(launched: launched, tokenBody: const {});
    var capturedState = '';
    final launcherSession = KeycloakSession(
      issuer: 'http://127.0.0.1:4285/identity/realms/autonexus',
      clientId: 'autonexus-mobile',
      redirectUrl: 'bo.edu.uagrm.autonexus://auth/callback',
      store: store,
      launchBrowser: (url) async {
        capturedState = url.queryParameters['state']!;
        return true;
      },
      httpClient: _FakeClient(const {}),
    );
    await launcherSession.signIn();
    expect(capturedState, isNotEmpty);
    final pending = await store.pendingAuthorization(capturedState);
    expect(pending, isNotNull);
    expect(pending!.codeVerifier.length, greaterThan(40));
    expect(session.hasSession, isFalse);
    expect(launched, isNull, reason: 'the first session never opened a browser');
  });

  test('a callback redeemed by a new instance (restarted app) uses the stored verifier', () async {
    var state = '';
    final first = KeycloakSession(
      issuer: 'http://127.0.0.1:4285/identity/realms/autonexus',
      clientId: 'autonexus-mobile',
      redirectUrl: 'bo.edu.uagrm.autonexus://auth/callback',
      store: store,
      launchBrowser: (url) async {
        state = url.queryParameters['state']!;
        return true;
      },
      httpClient: _FakeClient(const {}),
    );
    await first.signIn();
    final stored = await store.pendingAuthorization(state);

    // Second process: same database, fresh in-memory tokens.
    final client = _FakeClient(_tokenPayload());
    final second = KeycloakSession(
      issuer: 'http://127.0.0.1:4285/identity/realms/autonexus',
      clientId: 'autonexus-mobile',
      redirectUrl: 'bo.edu.uagrm.autonexus://auth/callback',
      store: store,
      launchBrowser: (_) async => true,
      httpClient: client,
    );
    final snapshot = await second.completeAuthorization(Uri.parse('bo.edu.uagrm.autonexus://auth/callback?code=abc123&state=$state'));

    expect(snapshot.authenticated, isTrue, reason: 'error: ${snapshot.error} calls: ${client.calls}');
    expect(snapshot.subject, 'employee-subject');
    expect(snapshot.roles, contains('mecanico'));
    expect(client.lastBody['code_verifier'], stored!.codeVerifier);
    expect(client.lastBody['grant_type'], 'authorization_code');
    expect(await store.pendingAuthorization(state), isNull, reason: 'the state is consumed once');
  });

  test('a callback with an unknown state is refused and no request is sent', () async {
    final client = _FakeClient(_tokenPayload());
    final session = KeycloakSession(
      issuer: 'http://127.0.0.1:4285/identity/realms/autonexus',
      clientId: 'autonexus-mobile',
      redirectUrl: 'bo.edu.uagrm.autonexus://auth/callback',
      store: store,
      launchBrowser: (_) async => true,
      httpClient: client,
    );
    final snapshot = await session.completeAuthorization(Uri.parse('bo.edu.uagrm.autonexus://auth/callback?code=abc&state=forged'));
    expect(snapshot.authenticated, isFalse);
    expect(client.calls, 0);
  });

  test('a denied authorization is reported as cancelled', () async {
    var state = '';
    final session = KeycloakSession(
      issuer: 'http://127.0.0.1:4285/identity/realms/autonexus',
      clientId: 'autonexus-mobile',
      redirectUrl: 'bo.edu.uagrm.autonexus://auth/callback',
      store: store,
      launchBrowser: (url) async {
        state = url.queryParameters['state']!;
        return true;
      },
      httpClient: _FakeClient(const {}),
    );
    await session.signIn();
    final snapshot = await session.completeAuthorization(Uri.parse('bo.edu.uagrm.autonexus://auth/callback?error=access_denied&state=$state'));
    expect(snapshot.authenticated, isFalse);
    expect(snapshot.error, contains('cancelado'));
  });

  test('an expired access token is renewed with the refresh token', () async {
    var state = '';
    final session = KeycloakSession(
      issuer: 'http://127.0.0.1:4285/identity/realms/autonexus',
      clientId: 'autonexus-mobile',
      redirectUrl: 'bo.edu.uagrm.autonexus://auth/callback',
      store: store,
      launchBrowser: (url) async {
        state = url.queryParameters['state']!;
        return true;
      },
      httpClient: _FakeClient(_tokenPayload(expiresIn: 0)),
    );
    await session.signIn();
    await session.completeAuthorization(Uri.parse('bo.edu.uagrm.autonexus://auth/callback?code=abc&state=$state'));
    final token = await session.accessToken(margin: const Duration(seconds: 30));
    expect(token, isNotNull, reason: 'the refresh grant renews it instead of returning nothing');
  });
}

Map<String, String> _tokenPayload({int expiresIn = 60}) {
  final payload = base64Url.encode(utf8.encode(jsonEncode({
    'sub': 'employee-subject',
    'preferred_username': 'employee-demo',
    'realm_access': {
      'roles': ['mecanico', 'offline'],
    },
  }))).replaceAll('=', '');
  return {
    'access_token': 'header.$payload.signature',
    'refresh_token': 'refresh-token',
    'id_token': 'header.$payload.signature',
    'expires_in': '$expiresIn',
    'token_type': 'Bearer',
  };
}

class _FakeClient extends http.BaseClient {
  _FakeClient(this.payload);

  final Map<String, String> payload;
  final Map<String, String> lastBody = {};
  int calls = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    calls++;
    if (request is http.Request) lastBody.addAll(request.bodyFields);
    final body = jsonEncode(payload);
    return http.StreamedResponse(Stream.value(utf8.encode(body)), 200, headers: {'content-type': 'application/json'});
  }
}
