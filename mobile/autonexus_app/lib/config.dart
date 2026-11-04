/// Non-secret runtime configuration loaded from the bundled `.env` asset before `runApp`.
///
/// The app has no client secret or storage credential. Values in a Flutter asset are extracted from
/// the APK, so this file must contain public configuration only.
library;

import 'package:flutter_dotenv/flutter_dotenv.dart';

class AppConfig {
  const AppConfig._();

  /// Exact issuer of the realm; it must match the issuer in the ID token.
  static String get issuer => dotenv.get(
    'AUTONEXUS_ISSUER',
    fallback: 'http://127.0.0.1:4285/identity/realms/autonexus',
  );

  /// Public native client; its redirect is also registered in Keycloak and AndroidManifest.
  static String get clientId =>
      dotenv.get('AUTONEXUS_CLIENT_ID', fallback: 'autonexus-mobile');
  static const String redirectUrl = 'bo.edu.uagrm.autonexus://auth/callback';

  /// Mobile speaks REST to the owner and to MS05; web stays behind the BFF.
  static String get ownerUrl =>
      dotenv.get('AUTONEXUS_OWNER_URL', fallback: 'http://127.0.0.1:8081');
  static String get syncUrl =>
      dotenv.get('AUTONEXUS_SYNC_URL', fallback: 'http://127.0.0.1:3005');

  static int get preparationDays =>
      int.tryParse(dotenv.get('AUTONEXUS_PREPARATION_DAYS', fallback: '7')) ??
      7;
}
