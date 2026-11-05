import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:autonexus_mobile/config.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(dotenv.clean);
  for (final port in [4285, 4286]) {
    test(
      'loads explicit public configuration on port $port without private assets',
      () {
        dotenv.loadFromString(
          envString:
              '''
AUTONEXUS_ISSUER=http://127.0.0.1:$port/identity/realms/autonexus
AUTONEXUS_CLIENT_ID=autonexus-mobile
AUTONEXUS_OWNER_URL=http://127.0.0.1:8081
AUTONEXUS_SYNC_URL=http://127.0.0.1:3005
AUTONEXUS_PREPARATION_DAYS=7
''',
        );

        expect(
          AppConfig.issuer,
          'http://127.0.0.1:$port/identity/realms/autonexus',
        );
        expect(AppConfig.clientId, 'autonexus-mobile');
        expect(AppConfig.ownerUrl, 'http://127.0.0.1:8081');
        expect(AppConfig.syncUrl, 'http://127.0.0.1:3005');
        expect(AppConfig.preparationDays, 7);
        expect(AppConfig.redirectUrl, 'bo.edu.uagrm.autonexus://auth/callback');
      },
    );
  }
}
