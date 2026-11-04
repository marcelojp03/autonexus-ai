/// Real session for the mobile app: Authorization Code + PKCE in the system browser.
///
/// Policies reused from the rest of the platform:
///  * public client (`autonexus-mobile`), **no** client secret, no password grant;
///  * PKCE S256 and the explicit custom-scheme redirect registered in the realm;
///  * tokens live in memory only — never in SQLite, never in shared preferences;
///  * the access token is short lived by design, so the session renews it with the refresh token
///    before each call instead of asking for a longer one.
///
/// The flow is implemented here instead of delegated to a browser helper because the pending
/// authorization state has to be **persisted before the browser opens**: the system may restart the
/// app while the browser is in the foreground (observed on MIUI), and a state kept only in memory
/// makes the callback unredeemable. Only the verifier, the nonce and the state are stored; the tokens
/// are not.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import '../offline/offline_store.dart';
import 'pending_authorization.dart';

class SessionSnapshot {
  const SessionSnapshot({required this.authenticated, this.subject, this.name, this.roles = const [], this.expiresAt, this.error});

  final bool authenticated;
  final String? subject;
  final String? name;
  final List<String> roles;
  final DateTime? expiresAt;
  final String? error;

  static const signedOut = SessionSnapshot(authenticated: false);
}

/// Opens the authorization URL in the browser the platform provides.
typedef BrowserLauncher = Future<bool> Function(Uri url);

class KeycloakSession {
  KeycloakSession({
    required this.issuer,
    required this.clientId,
    required this.redirectUrl,
    required this.store,
    required this.launchBrowser,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  final String issuer;
  final String clientId;
  final String redirectUrl;
  final OfflineStore store;
  final BrowserLauncher launchBrowser;
  final http.Client _http;

  // Only these values are kept, and only in memory.
  String? _accessToken;
  String? _refreshToken;
  String? _idToken;
  DateTime? _expiresAt;
  SessionSnapshot _snapshot = SessionSnapshot.signedOut;

  SessionSnapshot get snapshot => _snapshot;

  bool get hasSession => _accessToken != null;

  /// Starts the flow: persists the state, opens the system browser and waits for the redirect.
  ///
  /// Returns `null` while waiting for the callback; [completeAuthorization] finishes the flow, also
  /// when the callback arrives in a later process.
  Future<SessionSnapshot> signIn() async {
    final pending = PendingAuthorization(
      state: _randomToken(24),
      codeVerifier: _randomToken(48),
      nonce: _randomToken(24),
      redirectUrl: redirectUrl,
      createdAt: DateTime.now().toUtc(),
    );
    await store.savePendingAuthorization(pending);

    final challenge = base64Url.encode(sha256.convert(ascii.encode(pending.codeVerifier)).bytes).replaceAll('=', '');
    final url = Uri.parse('$issuer/protocol/openid-connect/auth').replace(queryParameters: {
      'client_id': clientId,
      'redirect_uri': redirectUrl,
      'response_type': 'code',
      'scope': 'openid profile roles',
      'state': pending.state,
      'nonce': pending.nonce,
      'code_challenge': challenge,
      'code_challenge_method': 'S256',
    });

    final opened = await launchBrowser(url);
    if (!opened) {
      await store.clearPendingAuthorization(pending.state);
      _snapshot = const SessionSnapshot(authenticated: false, error: 'No hay navegador disponible para iniciar sesión.');
      return _snapshot;
    }
    _snapshot = const SessionSnapshot(authenticated: false);
    return _snapshot;
  }

  /// Redeems the authorization response. Safe to call from a new process: the verifier comes from the
  /// stored state, so the exchange is the one this client started.
  Future<SessionSnapshot> completeAuthorization(Uri callback) async {
    final state = callback.queryParameters['state'];
    final code = callback.queryParameters['code'];
    final error = callback.queryParameters['error'];

    if (state == null || (code == null && error == null)) {
      _snapshot = const SessionSnapshot(authenticated: false, error: 'La respuesta de autorización está incompleta.');
      return _snapshot;
    }
    final pending = await store.pendingAuthorization(state);
    if (pending == null || !pending.isUsableAt(DateTime.now().toUtc())) {
      _snapshot = const SessionSnapshot(authenticated: false, error: 'La autorización venció o no corresponde a este dispositivo.');
      return _snapshot;
    }
    if (error != null) {
      await store.clearPendingAuthorization(state);
      _snapshot = SessionSnapshot(authenticated: false, error: error == 'access_denied' ? 'Inicio de sesión cancelado.' : 'El proveedor respondió $error.');
      return _snapshot;
    }

    try {
      final response = await _http.post(
        Uri.parse('$issuer/protocol/openid-connect/token'),
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: {
          'grant_type': 'authorization_code',
          'client_id': clientId,
          'code': code,
          'redirect_uri': pending.redirectUrl,
          'code_verifier': pending.codeVerifier,
        },
      );
      if (response.statusCode != 200) {
        _snapshot = SessionSnapshot(authenticated: false, error: 'No se pudo canjear el código (${response.statusCode}).');
        return _snapshot;
      }
      final payload = jsonDecode(response.body) as Map<String, dynamic>;
      final idToken = payload['id_token'] as String?;
      final claims = _claims(idToken);
      final problem = _validateClaims(claims, pending, idToken != null);
      if (problem != null) {
        await store.clearPendingAuthorization(state);
        _snapshot = SessionSnapshot(authenticated: false, error: problem);
        return _snapshot;
      }
      await store.clearPendingAuthorization(state);
      return _adopt(payload);
    } catch (failure) {
      // The message is kept short and never includes tokens: it names the transport problem so the
      // operator can tell "no network" from "the server answered something unexpected".
      final detail = failure.toString();
      _snapshot = SessionSnapshot(
        authenticated: false,
        error: 'No se pudo canjear el código: ${detail.length > 160 ? detail.substring(0, 160) : detail}',
      );
      return _snapshot;
    }
  }

  /// OIDC checks the client can perform without the realm keys: the response must come from this
  /// issuer, be issued to this client and echo the nonce of the request that is being redeemed. A
  /// mismatch means the response does not belong to this transaction and is not adopted. Signature
  /// verification stays with the services, which are the ones that authorise the calls.
  String? _validateClaims(Map<String, dynamic> claims, PendingAuthorization pending, bool hasIdToken) {
    if (!hasIdToken) return 'La respuesta no incluye el token de identidad.';
    if (claims['iss'] != issuer) return 'El emisor del token no es el esperado.';
    final audience = claims['aud'];
    final audiences = audience is List ? audience.whereType<String>() : audience is String ? [audience] : const <String>[];
    if (!audiences.contains(clientId)) return 'El token no fue emitido para esta aplicación.';
    if (claims['nonce'] != pending.nonce) return 'La respuesta no corresponde a esta solicitud de inicio de sesión.';
    return null;
  }

  /// Renews the access token when it is about to expire. Returns `null` when the session is gone,
  /// which is the signal for the UI to ask for a new sign-in instead of retrying in a loop.
  Future<String?> accessToken({Duration margin = const Duration(seconds: 15)}) async {
    final current = _accessToken;
    if (current == null) return null;
    final expiresAt = _expiresAt;
    if (expiresAt != null && expiresAt.isAfter(DateTime.now().add(margin))) return current;

    final refresh = _refreshToken;
    if (refresh == null || refresh.isEmpty) return current;
    try {
      final response = await _http.post(
        Uri.parse('$issuer/protocol/openid-connect/token'),
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: {'grant_type': 'refresh_token', 'client_id': clientId, 'refresh_token': refresh},
      );
      if (response.statusCode != 200) {
        _clear();
        _snapshot = const SessionSnapshot(authenticated: false, error: 'La sesión venció.');
        return null;
      }
      _adopt(jsonDecode(response.body) as Map<String, dynamic>);
      return _accessToken;
    } catch (_) {
      // A transport failure is not a revoked session: keep the token and let the caller retry.
      return current;
    }
  }

  Future<void> signOut() async {
    final idToken = _idToken;
    _clear();
    _snapshot = SessionSnapshot.signedOut;
    if (idToken == null) return;
    try {
      await launchBrowser(Uri.parse('$issuer/protocol/openid-connect/logout').replace(queryParameters: {
        'id_token_hint': idToken,
        'post_logout_redirect_uri': redirectUrl,
        'client_id': clientId,
      }));
    } catch (_) {
      // Ending the remote session is best effort: the local session is already gone.
    }
  }

  void _clear() {
    _accessToken = null;
    _refreshToken = null;
    _idToken = null;
    _expiresAt = null;
  }

  SessionSnapshot _adopt(Map<String, dynamic> payload) {
    _accessToken = payload['access_token'] as String?;
    _refreshToken = payload['refresh_token'] as String?;
    _idToken = payload['id_token'] as String?;
    final rawExpires = payload['expires_in'];
    final expiresIn = rawExpires is num ? rawExpires.toInt() : int.tryParse('$rawExpires');
    _expiresAt = expiresIn == null ? null : DateTime.now().add(Duration(seconds: expiresIn));
    // Roles and subject come from the access token, which is what the services will read.
    final claims = _claims(_accessToken ?? _idToken);
    final realm = claims['realm_access'];
    final roles = (realm is Map ? (realm['roles'] as List?) : null)?.whereType<String>().toList() ?? const <String>[];
    _snapshot = SessionSnapshot(
      authenticated: _accessToken != null,
      subject: claims['sub'] as String?,
      name: (claims['preferred_username'] ?? claims['name']) as String?,
      roles: roles,
      expiresAt: _expiresAt,
    );
    return _snapshot;
  }

  /// Minimal JWT payload reader: the signature is verified by every service, the app only needs the
  /// subject and the roles to render its UI.
  Map<String, dynamic> _claims(String? token) {
    if (token == null) return const {};
    final parts = token.split('.');
    if (parts.length < 2) return const {};
    try {
      final payload = parts[1].replaceAll('-', '+').replaceAll('_', '/');
      final padded = payload.padRight((payload.length + 3) ~/ 4 * 4, '=');
      final decoded = utf8.decode(base64.decode(padded));
      final json = jsonDecode(decoded);
      return json is Map<String, dynamic> ? json : const {};
    } catch (_) {
      return const {};
    }
  }

  String _randomToken(int bytes) {
    final random = Random.secure();
    final values = List<int>.generate(bytes, (_) => random.nextInt(256));
    return base64Url.encode(values).replaceAll('=', '');
  }
}
