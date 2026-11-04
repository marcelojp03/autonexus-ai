import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:autonexus_mobile/config.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('loads the local .env asset before building API clients', () async {
    await dotenv.load(fileName: 'assets/config/.env');

    expect(AppConfig.issuer, 'http://127.0.0.1:4285/identity/realms/autonexus');
    expect(AppConfig.clientId, 'autonexus-mobile');
    expect(AppConfig.ownerUrl, 'http://127.0.0.1:8081');
    expect(AppConfig.syncUrl, 'http://127.0.0.1:3005');
    expect(AppConfig.preparationDays, 7);
    expect(AppConfig.redirectUrl, 'bo.edu.uagrm.autonexus://auth/callback');
  });
}
