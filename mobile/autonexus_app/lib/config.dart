/// Endpoints and policy values of the mobile client.
///
/// They are `--dart-define` values with the loopback defaults the local stack publishes; a real
/// deployment overrides them at build time. Nothing secret lives here: the app has no client secret
/// and no storage credential.
library;

class AppConfig {
  const AppConfig._();

  /// Exact issuer of the realm; the same value the platform uses for the Shell and the services.
  static const String issuer = String.fromEnvironment(
    'AUTONEXUS_ISSUER',
    defaultValue: 'http://127.0.0.1:4285/identity/realms/autonexus',
  );

  /// Public mobile client with an explicit custom-scheme redirect: Authorization Code + PKCE only.
  static const String clientId = String.fromEnvironment('AUTONEXUS_CLIENT_ID', defaultValue: 'autonexus-mobile');
  static const String redirectUrl = 'bo.edu.uagrm.autonexus://auth/callback';

  /// Owner REST API. The mobile client speaks REST to the owner; the web goes through the BFF.
  static const String ownerUrl = String.fromEnvironment('AUTONEXUS_OWNER_URL', defaultValue: 'http://127.0.0.1:8081');

  /// MS05 coordinator: the only path that writes on the owner's behalf while offline work is queued.
  static const String syncUrl = String.fromEnvironment('AUTONEXUS_SYNC_URL', defaultValue: 'http://127.0.0.1:3005');

  /// How long a prepared copy may be used before it must be revalidated online.
  static const int preparationDays = int.fromEnvironment('AUTONEXUS_PREPARATION_DAYS', defaultValue: 7);
}
